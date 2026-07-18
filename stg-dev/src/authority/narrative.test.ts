import {describe, expect, it} from "vitest";
import {
  CanonicalEventBus,
  V4_ENVELOPE_REQUIRED_FIELDS,
  type CanonicalGameplayEvent,
  type GameplayEventDraft,
  type JsonObject,
  type JsonValue,
} from "./events";
import {
  assertRunMemory,
  RunMemoryRecorder,
  validateRunMemory,
  type FinalizedRunMemory,
  type RunMemory,
} from "../game/run-memory";
import {
  AUTHORED_BOSS_RESOLUTIONS,
  AUTHORED_ROOM_THRESHOLDS,
  AUTHORED_SNAPSHOT_OBSERVATIONS,
  AUTHORED_WORLD_REACTION_EDGES,
  NARRATIVE_AUTHORITY_REPORT,
  NARRATIVE_ROOM_IDS,
  NarrativeAuthority,
  evaluateObservationCondition,
  selectSnapshotObservations,
  validateNarrativeRecord,
  type AuthoredObservationDefinition,
  type NarrativeAuthorityOptions,
  type NarrativeRoomId,
} from "./narrative";

function makeMemory(): FinalizedRunMemory {
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

function mutableMemoryClone(memory: FinalizedRunMemory): RunMemory {
  const clone: unknown = structuredClone(memory);
  assertRunMemory(clone);
  return clone;
}

function routeFacts(memory: FinalizedRunMemory): {
  readonly routeDigest: string;
  readonly routeDurationMs: number;
} {
  if (memory.ghostRoute === null) throw new Error("test memory must have a route");
  return {
    routeDigest: memory.ghostRoute.routeDigest,
    routeDurationMs: memory.ghostRoute.points.at(-1)?.tMs ?? 0,
  };
}

function snapshotPayload(memory: FinalizedRunMemory): JsonObject {
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

function restoreEvents(memory: FinalizedRunMemory, startTick = 1): readonly CanonicalGameplayEvent[] {
  if (memory.ghostRoute === null) throw new Error("test memory must have a route");
  const identity = {fromRunId: memory.run.id, nextRunId: "run-narrative-v4-next"};
  const route = routeFacts(memory);
  const routeFinalPoint = memory.ghostRoute.points.at(-1);
  if (routeFinalPoint === undefined) throw new Error("test memory must have a final route point");
  const finalPoint = {
    tMs: routeFinalPoint.tMs,
    xNorm: routeFinalPoint.xNorm,
    yNorm: routeFinalPoint.yNorm,
    room: routeFinalPoint.room,
  };
  const ghostEndpoint = {
    room: routeFinalPoint.room,
    xNorm: routeFinalPoint.xNorm,
    yNorm: routeFinalPoint.yNorm,
  };
  return Object.freeze([
    event("cross_run.restore.begin", {...identity, ...route}, startTick),
    event("overrideScar.rehydrate", {
      ...identity,
      recordType: "overrideScar",
      count: memory.materialMemory.overrideScars.length,
      records: memory.materialMemory.overrideScars as unknown as JsonValue,
    }, startTick + 1),
    event("deathTrace.rehydrate", {
      ...identity,
      recordType: "deathTrace",
      count: memory.materialMemory.deathTraces.length,
      records: memory.materialMemory.deathTraces as unknown as JsonValue,
    }, startTick + 2),
    event("burnIn.rehydrate", {
      ...identity,
      recordType: "burnIn",
      count: memory.materialMemory.burnIns.length,
      records: memory.materialMemory.burnIns as unknown as JsonValue,
    }, startTick + 3),
    event("ghost.replay.begin", {
      ...identity,
      ...route,
      pointCount: memory.ghostRoute.points.length,
      routePoints: memory.ghostRoute.points as unknown as JsonValue,
      timeScale: 1,
      collisionClass: "NONE",
      rewardClass: "NONE",
      emitterClass: "NONE",
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
      residueId: `ghost-residue:${memory.run.id}:run-narrative-v4-next`,
      sourceRouteDigest: memory.ghostRoute.routeDigest,
      createdAfterReplay: true,
      persistenceRuns: 1,
      position: ghostEndpoint,
      priorGhostResidueCount: memory.materialMemory.ghostResidues.length,
    }, startTick + 6),
    event("witness.turn", {
      ...identity,
      evaluatedAfterGhostResidue: true,
      overrideScarIds: memory.materialMemory.overrideScars.map((scar) => scar.id),
      ghostEndpoint,
      priority: ["nearbyOverrideScar", "ghostEndpoint", "resistanceTransmission", "eclipse", "resonance", "clamp", "idle"],
    }, startTick + 7),
    event("returnInput", {
      ...identity,
      inputState: "enabled",
      routeDurationMs: route.routeDurationMs,
    }, startTick + 8),
    event("cross_run.restore.complete", {...identity, ...route}, startTick + 9),
  ]);
}

function stateSequence(memory: FinalizedRunMemory): readonly CanonicalGameplayEvent[] {
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
  const memory = mutableMemoryClone(makeMemory());
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
    if (comparison.left === "materialMemory.ghostResidues.length") {
      if (typeof literal !== "number" || memory.ghostRoute === null) {
        throw new Error("ghost residue length comparison requires a route and numeric literal");
      }
      const targetCount = comparison.operator === ">"
        ? Math.floor(literal) + 1
        : comparison.operator === ">=" || comparison.operator === "=="
          ? Math.ceil(literal)
          : comparison.operator === "!="
            ? literal === 0 ? 1 : 0
            : Math.max(0, Math.ceil(literal) - 1);
      const endpoint = memory.ghostRoute.points.at(-1);
      if (endpoint === undefined) throw new Error("ghost residue condition requires a route endpoint");
      memory.materialMemory.ghostResidues = Array.from({length: targetCount}, (_, index) => ({
        id: `observation-ghost-residue-${index}`,
        position: {room: endpoint.room, xNorm: endpoint.xNorm, yNorm: endpoint.yNorm},
        sourceRouteDigest: memory.ghostRoute?.routeDigest ?? "",
        createdAfterReplay: true as const,
        persistenceRuns: 1,
      }));
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

  it("allows archive persistence immediately after serialize without manufacturing BOOT handoff", () => {
    const memory = makeMemory();
    const authority = new NarrativeAuthority({
      snapshotRecord: validateNarrativeRecord(memory, assertRunMemory),
    });
    authority.consume(event("snapshot.begin", {runId: memory.run.id}, 1));
    authority.consume(event("snapshot.serialize.commit", snapshotPayload(memory), 2));
    authority.consume(event("cross_run.record.persist.commit", snapshotPayload(memory), 2,
      "snapshot-persist-at-serialize-boundary"));

    expect(authority.snapshot()).toMatchObject({
      state: "BOOT_REHYDRATE",
      handoffReady: false,
      processedOccurrences: 3,
    });
    expect(authority.snapshot().observations.length).toBeGreaterThan(0);

    authority.consume(event("snapshot.present.begin", {
      runId: memory.run.id,
      snapshotHash: memory.fingerprint.digestSha256,
    }, 3));
    authority.consume(event("snapshot.complete", {runId: memory.run.id}, 4));
    expect(authority.snapshot()).toMatchObject({
      state: "BOOT_REHYDRATE",
      handoffReady: false,
      processedOccurrences: 5,
    });
  });

  it("preflights snapshot identity and keeps rejected events mutation-free for retry", () => {
    const memory = makeMemory();
    const authority = new NarrativeAuthority({
      snapshotRecord: validateNarrativeRecord(memory, assertRunMemory),
    });
    authority.consume(event("snapshot.begin", {runId: memory.run.id}, 1));
    const expectRejectedWithoutMutation = (
      rejected: CanonicalGameplayEvent,
      message: RegExp,
    ): void => {
      const before = authority.canonicalSerialization();
      expect(() => authority.consume(rejected)).toThrow(message);
      expect(authority.canonicalSerialization()).toBe(before);
    };

    const forgedSerialize = event("snapshot.serialize.commit", {
      ...snapshotPayload(memory),
      snapshotHash: "f".repeat(64),
    }, 2, "snapshot-forged-serialize-hash");
    expectRejectedWithoutMutation(forgedSerialize, /snapshotHash does not match/);
    expectRejectedWithoutMutation(forgedSerialize, /snapshotHash does not match/);

    const wrongCounts = event("snapshot.serialize.commit", {
      ...snapshotPayload(memory),
      materialCounts: {
        overrideScars: 999,
        deathTraces: memory.materialMemory.deathTraces.length,
        burnIns: memory.materialMemory.burnIns.length,
        ghostResidues: memory.materialMemory.ghostResidues.length,
      },
    }, 2, "snapshot-forged-serialize-counts");
    expectRejectedWithoutMutation(wrongCounts, /materialCounts does not match/);

    authority.consume(event("snapshot.serialize.commit", snapshotPayload(memory), 2));
    expect(authority.snapshot().observations.length).toBeGreaterThan(0);

    const forgedPersist = event("cross_run.record.persist.commit", {
      ...snapshotPayload(memory),
      snapshotHash: "0".repeat(64),
    }, 3, "snapshot-forged-persist-hash");
    expectRejectedWithoutMutation(forgedPersist, /snapshotHash does not match/);
    const extraCountPersist = event("cross_run.record.persist.commit", {
      ...snapshotPayload(memory),
      materialCounts: {
        overrideScars: memory.materialMemory.overrideScars.length,
        deathTraces: memory.materialMemory.deathTraces.length,
        burnIns: memory.materialMemory.burnIns.length,
        ghostResidues: memory.materialMemory.ghostResidues.length,
        inventedMaterial: 1,
      },
    }, 3, "snapshot-forged-persist-extra-count");
    expectRejectedWithoutMutation(extraCountPersist, /materialCounts does not match/);

    authority.consume(event("cross_run.record.persist.commit", snapshotPayload(memory), 3));
    authority.consume(event("snapshot.present.begin", {
      runId: memory.run.id,
      snapshotHash: memory.fingerprint.digestSha256,
    }, 4));
    authority.consume(event("snapshot.complete", {runId: memory.run.id}, 5));
    expect(authority.snapshot().handoffReady).toBe(false);
  });

  it("rejects fresh-key snapshot lifecycle duplicates and out-of-order archive facts atomically", () => {
    const memory = makeMemory();
    const token = validateNarrativeRecord(memory, assertRunMemory);
    const authority = new NarrativeAuthority({snapshotRecord: token});
    const rejectWithoutMutation = (rejected: CanonicalGameplayEvent, message: RegExp): void => {
      const before = authority.canonicalSerialization();
      expect(() => authority.consume(rejected)).toThrow(message);
      expect(authority.canonicalSerialization()).toBe(before);
    };

    rejectWithoutMutation(
      event("cross_run.record.persist.commit", snapshotPayload(memory), 1, "persist-before-snapshot"),
      /out of order from idle/,
    );
    rejectWithoutMutation(
      event("snapshot.serialize.commit", snapshotPayload(memory), 1, "serialize-before-begin"),
      /out of order from idle/,
    );
    rejectWithoutMutation(
      event("snapshot.begin", {runId: "wrong-current-run"}, 1, "snapshot-begin-wrong-run"),
      /runId does not match/,
    );
    const begin = event("snapshot.begin", {runId: memory.run.id}, 1);
    authority.consume(begin);
    authority.consume(begin);
    rejectWithoutMutation(
      event("snapshot.begin", {runId: memory.run.id}, 2, "duplicate-snapshot-begin"),
      /out of order from capturing/,
    );
    rejectWithoutMutation(
      event("snapshot.present.begin", {
        runId: memory.run.id,
        snapshotHash: memory.fingerprint.digestSha256,
      }, 2, "present-before-serialize"),
      /out of order from capturing/,
    );

    authority.consume(event("snapshot.serialize.commit", snapshotPayload(memory), 2));
    rejectWithoutMutation(
      event("snapshot.serialize.commit", snapshotPayload(memory), 3, "duplicate-snapshot-serialize"),
      /out of order from serialized/,
    );
    authority.consume(event("cross_run.record.persist.commit", snapshotPayload(memory), 3));
    rejectWithoutMutation(
      event("cross_run.record.persist.commit", snapshotPayload(memory), 4, "duplicate-snapshot-persist"),
      /cannot persist twice/,
    );
    rejectWithoutMutation(
      event("snapshot.complete", {runId: memory.run.id}, 4, "complete-before-present"),
      /out of order from serialized/,
    );
    rejectWithoutMutation(
      event("snapshot.present.begin", {
        runId: memory.run.id,
        snapshotHash: "a".repeat(64),
      }, 4, "snapshot-present-wrong-hash"),
      /snapshotHash does not match/,
    );

    authority.consume(event("snapshot.present.begin", {
      runId: memory.run.id,
      snapshotHash: memory.fingerprint.digestSha256,
    }, 5));
    rejectWithoutMutation(
      event("snapshot.complete", {runId: "wrong-current-run"}, 6, "snapshot-complete-wrong-run"),
      /changed the active snapshot runId/,
    );
    rejectWithoutMutation(
      event("snapshot.present.begin", {
        runId: memory.run.id,
        snapshotHash: memory.fingerprint.digestSha256,
      }, 6, "duplicate-snapshot-present"),
      /out of order from presenting/,
    );
    authority.consume(event("snapshot.complete", {runId: memory.run.id}, 6));
    rejectWithoutMutation(
      event("snapshot.complete", {runId: memory.run.id}, 7, "duplicate-snapshot-complete"),
      /out of order from complete/,
    );
    expect(authority.snapshot()).toMatchObject({
      state: "BOOT_REHYDRATE",
      handoffReady: false,
      processedOccurrences: 5,
    });
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
    const mutatedClone = mutableMemoryClone(memory);
    mutatedClone.run.id = "mutated-after-validation";
    const authority = new NarrativeAuthority({previousRun: token});
    const immutableRecordValue: unknown = structuredClone(token.read());
    assertRunMemory(immutableRecordValue);
    const immutableRecord = immutableRecordValue;
    authority.consumeMany(restoreEvents(immutableRecord));
    const snapshot = authority.snapshot();
    expect(snapshot.crossRun[0]?.fromRunId).toBe("run-narrative-v4");
    expect(snapshot.crossRun.find(({eventId}) => eventId === "overrideScar.rehydrate")?.recordCount).toBe(1);
    expect(authority.canonicalSerialization()).toContain(immutableRecord.ghostRoute?.routeDigest ?? "missing-route");
    expect(authority.canonicalSerialization()).not.toContain("mutated-after-validation");
    expect(() => new NarrativeAuthority().consume(restoreEvents(immutableRecord)[0] as CanonicalGameplayEvent))
      .toThrow(/validated previous-run record/);
  });

  it("rejects malformed authority-bearing restore payloads against the validated record", () => {
    const memory = makeMemory();
    const token = validateNarrativeRecord(memory, assertRunMemory);
    const validEvents = restoreEvents(memory);
    const cases = [
      {
        label: "material records",
        eventId: "overrideScar.rehydrate",
        mutate: (payload: Record<string, unknown>) => { payload.records = []; },
        message: /payload\.records does not match the validated record/,
      },
      {
        label: "actual route points",
        eventId: "ghost.replay.begin",
        mutate: (payload: Record<string, unknown>) => { payload.routePoints = []; },
        message: /routePoints does not match the validated record/,
      },
      {
        label: "ghost emitter class",
        eventId: "ghost.replay.begin",
        mutate: (payload: Record<string, unknown>) => { payload.emitterClass = "PRESENTATION_ONLY"; },
        message: /classes must all remain NONE/,
      },
      {
        label: "ghost completion endpoint",
        eventId: "ghost.replay.complete",
        mutate: (payload: Record<string, unknown>) => {
          payload.finalPoint = {tMs: 240, xNorm: 0.1, yNorm: 0.4, room: "INFORMATION"};
        },
        message: /finalPoint does not match the validated record/,
      },
      {
        label: "witness evaluation order",
        eventId: "witness.turn",
        mutate: (payload: Record<string, unknown>) => { payload.evaluatedAfterGhostResidue = false; },
        message: /evaluated after ghost residue/,
      },
      {
        label: "witness priority",
        eventId: "witness.turn",
        mutate: (payload: Record<string, unknown>) => { payload.priority = ["idle"]; },
        message: /priority does not match the validated record/,
      },
      {
        label: "witness endpoint",
        eventId: "witness.turn",
        mutate: (payload: Record<string, unknown>) => {
          payload.ghostEndpoint = {room: "INFORMATION", xNorm: 0.1, yNorm: 0.4};
        },
        message: /ghostEndpoint does not match the validated record/,
      },
      {
        label: "input return state",
        eventId: "returnInput",
        mutate: (payload: Record<string, unknown>) => { payload.inputState = "READY"; },
        message: /enabled input state/,
      },
    ] as const;

    for (const testCase of cases) {
      const index = validEvents.findIndex(({id}) => id === testCase.eventId);
      if (index < 0) throw new Error(`missing restore test event: ${testCase.eventId}`);
      const valid = validEvents[index];
      if (valid === undefined) throw new Error(`missing indexed restore test event: ${testCase.eventId}`);
      const payload = structuredClone(valid.payload) as Record<string, unknown>;
      testCase.mutate(payload);
      const malformed = event(
        valid.id,
        payload as JsonObject,
        valid.tick120,
        `${valid.occurrenceKey}:malformed:${testCase.label}`,
      );
      const authority = new NarrativeAuthority({previousRun: token});
      authority.consumeMany(validEvents.slice(0, index));
      expect(() => authority.consume(malformed), testCase.label).toThrow(testCase.message);
    }

    const ghostBeginIndex = validEvents.findIndex(({id}) => id === "ghost.replay.begin");
    const ghostComplete = validEvents.find(({id}) => id === "ghost.replay.complete");
    if (ghostBeginIndex < 0 || ghostComplete === undefined) {
      throw new Error("restore ordering test requires ghost begin and complete events");
    }
    const skippedBegin = new NarrativeAuthority({previousRun: token});
    skippedBegin.consumeMany(validEvents.slice(0, ghostBeginIndex));
    expect(() => skippedBegin.consume(ghostComplete)).toThrow(/rehydration order/);

    const duplicateBegin = new NarrativeAuthority({previousRun: token});
    const restoreBegin = validEvents[0];
    if (restoreBegin === undefined) throw new Error("restore ordering test requires restore begin");
    duplicateBegin.consume(restoreBegin);
    const secondBegin = event(
      restoreBegin.id,
      restoreBegin.payload,
      restoreBegin.tick120 + 1,
      `${restoreBegin.occurrenceKey}:duplicate-begin`,
    );
    expect(() => duplicateBegin.consume(secondBegin)).toThrow(/cannot restart/);
  });

  it("parks at the conjunctive Flower recovery barrier after gaze release and room swaps", () => {
    const memory = makeMemory();
    const token = validateNarrativeRecord(memory, assertRunMemory);
    const authority = new NarrativeAuthority({previousRun: token, snapshotRecord: token});
    const events = stateSequence(memory);
    const secondRoomSwapIndex = events.findIndex((event, index) =>
      event.id === "room.transition.world_swap.commit"
      && events.slice(0, index).some((prior) => prior.id === "room.transition.world_swap.commit"));
    if (secondRoomSwapIndex < 0) throw new Error("barrier test requires two room world swaps");
    authority.consumeMany(events.slice(0, secondRoomSwapIndex + 1));
    const snapshot = authority.snapshot();
    expect(snapshot.state).toBe("FIRST_CLAMP_RECOVERY");
    expect(snapshot.transitions.map(({to}) => to)).toEqual([
      "GHOST_REPLAY",
      "WITNESS_ORIENTATION",
      "AWAKENING",
      "FIRST_EYE",
      "FIRST_CLAMP_RECOVERY",
    ]);
    expect(snapshot.transitions.some(({to}) => to === "ROOM_SAMPLING")).toBe(false);
    expect(snapshot.handoffReady).toBe(false);
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
