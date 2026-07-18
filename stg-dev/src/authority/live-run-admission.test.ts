import {readFile} from "node:fs/promises";
import {describe, expect, it, vi} from "vitest";
import bossRigsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import {SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS} from "./combat-kernel";
import {CanonicalEventBus} from "./events";
import {
  LIVE_ROOM_CAPABILITY_ADMISSION_CONTRACT,
  LIVE_RUN_ADMISSION_CONTRACT,
  admitLiveRoomCapability,
  admitLiveRun,
  type LiveRoomCapabilityAdmissionResult,
  type LiveRunAdmissionResult,
} from "./live-run-admission";
import {composeV4RunComposerPlan, V4_RUN_COMPOSER_METRIC_IDS} from "./run-composer";

const RAW_RUN_SEED = 0x1234_5678;
const SELECTION_SALT = 0xec40;

const patternById = new Map(executablePatternsJson.patterns.map((pattern) => [pattern.id, pattern]));
const bossById = new Map(bossRigsJson.rigs.map((boss) => [boss.id, boss]));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function xor(...values: readonly number[]): number {
  return values.reduce((result, value) => (result ^ value) >>> 0, 0);
}

function resolvedSeed(patternId: string, encounterOrdinal: number, difficultySalt: number) {
  const pattern = patternById.get(patternId);
  if (pattern === undefined) throw new Error(`test fixture lost pattern ${patternId}`);
  return {
    domain: "resolved-occurrence-seed",
    value: xor(RAW_RUN_SEED, pattern.seed.base, encounterOrdinal, difficultySalt),
  };
}

function selectionSeed(encounterOrdinal: number) {
  return {
    domain: "parallel-selection-seed",
    value: xor(RAW_RUN_SEED, encounterOrdinal, SELECTION_SALT),
  };
}

function segments(patternId: string) {
  const pattern = patternById.get(patternId);
  if (pattern === undefined) throw new Error(`test fixture lost pattern ${patternId}`);
  return {
    telegraphMs: 520,
    entryMs: 800,
    readMs: pattern.durationMs,
    materialSettleMs: 900,
    restMs: 1600,
    safeGapHandoffMs: 520,
  };
}

function encounter(roomOrdinal: number, encounterOrdinal: number, patternId: string, salt: number) {
  return {
    occurrenceId: `room:${roomOrdinal}:encounter:${encounterOrdinal}:${patternId}`,
    patternId,
    encounterOrdinal,
    difficulty: "EASY",
    difficultySalt: salt,
    resolvedSeed: resolvedSeed(patternId, encounterOrdinal, salt),
    segments: segments(patternId),
    parallel: {
      mode: "none",
      selectionSeed: selectionSeed(encounterOrdinal),
    },
  };
}

function bossFixture(bossId: string) {
  const boss = bossById.get(bossId);
  if (boss === undefined) throw new Error(`test fixture lost Boss ${bossId}`);
  return {
    bossId,
    phases: boss.phases.map((phase, index) => {
      const salt = 0x3300 + index;
      return {
        occurrenceId: `${bossId}:phase:${index}`,
        phaseId: phase.id,
        patternId: phase.patternId,
        encounterOrdinal: 10 + index,
        difficulty: "EASY",
        difficultySalt: salt,
        resolvedSeed: resolvedSeed(phase.patternId, 10 + index, salt),
      };
    }),
  };
}

function metrics() {
  return Object.fromEntries(V4_RUN_COMPOSER_METRIC_IDS.map((id, index) => [id, (index + 1) / 20]));
}

function candidateFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-run-admission",
    authority: "caller-resolved-live-run",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    roomCount: 2,
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    rooms: [
      {
        roomId: "FORCED_ALIGNMENT",
        roomOrdinal: 0,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [encounter(0, 0, "room.forced.left_right_gate", 0x1100)],
      },
      {
        roomId: "IN_BETWEEN",
        roomOrdinal: 1,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [encounter(1, 0, "room.in_between.context_switch", 0x2200)],
      },
    ],
    boss: bossFixture("boss.misreader"),
  };
}

function roomCapabilityFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "POLARIZED",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [
        encounter(0, 0, "room.polarized.alternating_verdict", 0x2200),
        encounter(0, 1, "room.polarized.hard_cut_corridor", 0x2201),
      ],
    },
  };
}

function clockDecreeRoomCapabilityFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "POLARIZED",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [encounter(0, 0, "room.polarized.clock_decree", 0x2200)],
    },
  };
}

function noDuskGridRoomCapabilityFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "POLARIZED",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [encounter(0, 0, "room.polarized.no_dusk_grid", 0x2200)],
    },
  };
}

function stalePacketRoomCapabilityFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "INFORMATION",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [encounter(0, 0, "room.information.stale_packet_retry", 0x2200)],
    },
  };
}

function contextSwitchRoomCapabilityFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "IN_BETWEEN",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [encounter(0, 0, "room.in_between.context_switch", 0x2200)],
    },
  };
}

function ballotShiftRoomCapabilityFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "FORCED_ALIGNMENT",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [encounter(0, 0, "room.forced.ballot_shift", 0x2200)],
    },
  };
}

function leftRightGateRoomCapabilityFixture(): Record<string, unknown> {
  const occurrence = encounter(0, 0, "room.forced.left_right_gate", 0x1100);
  occurrence.segments = {
    telegraphMs: 520,
    entryMs: 800,
    readMs: 10_200,
    materialSettleMs: 1050,
    restMs: 1600,
    safeGapHandoffMs: 520,
  };
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "FORCED_ALIGNMENT",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [occurrence],
    },
  };
}

function polarizedFullRunFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-run-admission",
    authority: "caller-resolved-live-run",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    roomCount: 2,
    metricSnapshot: {
      producerId: "audit",
      producerVersion: "1",
      capturedAtTick120: 0,
      metrics: metrics(),
    },
    rooms: [
      {
        roomId: "FORCED_ALIGNMENT",
        roomOrdinal: 0,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [encounter(0, 0, "room.forced.left_right_gate", 0x1100)],
      },
      {
        roomId: "POLARIZED",
        roomOrdinal: 1,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [
          encounter(1, 0, "room.polarized.alternating_verdict", 0x2200),
          encounter(1, 1, "room.polarized.hard_cut_corridor", 0x2201),
        ],
      },
    ],
    boss: bossFixture("boss.no_dusk"),
  };
}

function rejection(result: LiveRunAdmissionResult) {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") throw new Error("expected rejected admission");
  return result;
}

function roomRejection(result: LiveRoomCapabilityAdmissionResult) {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") throw new Error("expected rejected room capability admission");
  return result;
}

function structurallyComplete(result: LiveRunAdmissionResult): string {
  if (result.status === "admitted") return result.gameplaySha256;
  expect(result.gameplaySha256).not.toBeNull();
  expect(result.rejections.every((entry) => entry.code === "unsupported-pattern")).toBe(true);
  return result.gameplaySha256 as string;
}

function pathText(path: readonly (string | number)[]): string {
  return `$${path.map((part) => typeof part === "number" ? `[${part}]` : `.${part}`).join("")}`;
}

function objectFieldPaths(value: unknown, prefix: readonly (string | number)[] = []): Array<readonly (string | number)[]> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => objectFieldPaths(entry, [...prefix, index]));
  }
  if (typeof value !== "object" || value === null) return [];
  const paths: Array<readonly (string | number)[]> = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = [...prefix, key];
    paths.push(path);
    paths.push(...objectFieldPaths(entry, path));
  }
  return paths;
}

function deleteAt(value: unknown, path: readonly (string | number)[]): void {
  let cursor = value as Record<string | number, unknown>;
  for (const part of path.slice(0, -1)) cursor = cursor[part] as Record<string | number, unknown>;
  delete cursor[path[path.length - 1] as string | number];
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const entry of Object.values(value)) expectDeepFrozen(entry);
}

describe("LiveRoomCapabilityAdmission", () => {
  it("admits the explicit POLARIZED pair as a frozen, bus-free, unscheduled capability", () => {
    expect(LIVE_ROOM_CAPABILITY_ADMISSION_CONTRACT).toEqual({
      schemaVersion: "1.0.0-live-room-capability",
      authority: "caller-resolved-live-room",
      rawRunSeedDomain: "raw-run-seed",
      resolvedOccurrenceSeedDomain: "resolved-occurrence-seed",
      parallelSelectionSeedDomain: "parallel-selection-seed",
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
      qaDefaultsAccepted: false,
      presentationAffectsHash: false,
    });
    expect(Object.isFrozen(LIVE_ROOM_CAPABILITY_ADMISSION_CONTRACT)).toBe(true);

    const candidate = roomCapabilityFixture();
    const before = JSON.stringify(candidate);
    const result = admitLiveRoomCapability(candidate);
    expect(result.status).toBe("admitted");
    if (result.status !== "admitted") throw new Error("POLARIZED room capability must admit");
    expect(result.gameplaySha256).toBe(
      "0659e91c3a0cabbf17a5a5961189d47f13f1a27e341360ad92aca34a674ba820",
    );
    expect(result.plan).toMatchObject({
      schemaVersion: "1.0.0-live-room-capability",
      authority: "caller-resolved-live-room",
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
      gameplaySha256: result.gameplaySha256,
      room: {
        roomId: "POLARIZED",
        roomOrdinal: 0,
        tierId: "listen",
        difficulty: "EASY",
      },
    });
    expect(result.plan.room.encounters.map((entry) => ({
      patternId: entry.patternId,
      encounterOrdinal: entry.encounterOrdinal,
      difficultySalt: entry.difficultySalt,
      resolvedSeed: entry.resolvedSeed.value,
      selectionSeed: entry.parallel.selectionSeed.value,
      readMs: entry.segments.readMs,
    }))).toEqual([
      {
        patternId: "room.polarized.alternating_verdict",
        encounterOrdinal: 0,
        difficultySalt: 0x2200,
        resolvedSeed: 0xe9f3_33c4,
        selectionSeed: 0x1234_ba38,
        readMs: 11_600,
      },
      {
        patternId: "room.polarized.hard_cut_corridor",
        encounterOrdinal: 1,
        difficultySalt: 0x2201,
        resolvedSeed: 0xff51_ab0b,
        selectionSeed: 0x1234_ba39,
        readMs: 10_800,
      },
    ]);
    expect(JSON.stringify(candidate)).toBe(before);
    expectDeepFrozen(result);
  });

  it("keeps the direct-kernel Clock Decree slice outside live-room admission", () => {
    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS)
      .not.toContain("room.polarized.clock_decree");
    const candidate = clockDecreeRoomCapabilityFixture();
    const before = JSON.stringify(candidate);
    const result = roomRejection(admitLiveRoomCapability(candidate));
    expect(result.gameplaySha256).toBe(
      "43bf1afb9a26ccbe5430a013e66feabf63d481b55d303aee328a237c192007e2",
    );
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({
      path: "$.room.encounters[0].patternId",
      code: "unsupported-pattern",
    });
    expect(JSON.stringify(candidate)).toBe(before);
    expect(LIVE_ROOM_CAPABILITY_ADMISSION_CONTRACT).toMatchObject({
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
    });
  });

  it("admits one stale-packet INFORMATION occurrence without inventing room order or execution", () => {
    const candidate = stalePacketRoomCapabilityFixture();
    const before = JSON.stringify(candidate);
    const result = admitLiveRoomCapability(candidate);
    expect(result.status).toBe("admitted");
    if (result.status !== "admitted") throw new Error("stale-packet capability must admit");
    expect(result.gameplaySha256).toBe(
      "7915d5ce98233f1e7f6a2f643b94b84a67b27dee71079d5833bc4c1aa5672c24",
    );
    expect(result.plan).toMatchObject({
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
      gameplaySha256: result.gameplaySha256,
      room: {
        roomId: "INFORMATION",
        roomOrdinal: 0,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [{
          patternId: "room.information.stale_packet_retry",
          encounterOrdinal: 0,
          difficultySalt: 0x2200,
          resolvedSeed: {domain: "resolved-occurrence-seed", value: 2492604871},
          segments: {readMs: 9800},
          parallel: {
            mode: "none",
            selectionSeed: {domain: "parallel-selection-seed", value: 305445432},
          },
        }],
      },
    });
    expect(JSON.stringify(candidate)).toBe(before);
    expectDeepFrozen(result);
  });

  it("admits caller-resolved Context Switch without creating a composer, bus, or execution", () => {
    const candidate = contextSwitchRoomCapabilityFixture();
    const before = JSON.stringify(candidate);
    const result = admitLiveRoomCapability(candidate);
    expect(result.status).toBe("admitted");
    if (result.status !== "admitted") throw new Error("Context Switch capability must admit");
    expect(result.gameplaySha256).toBe(
      "28c2b7463bb32f3d43e572fc23520464f1a5f0c680c239f6fd6d6ed0c7c987fe",
    );
    expect(result.plan).toMatchObject({
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
      room: {
        roomId: "IN_BETWEEN",
        roomOrdinal: 0,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [{
          patternId: "room.in_between.context_switch",
          encounterOrdinal: 0,
          difficultySalt: 0x2200,
          segments: {readMs: 11400},
          parallel: {mode: "none"},
        }],
      },
    });
    expect(JSON.stringify(candidate)).toBe(before);
    expectDeepFrozen(result);
  });

  it("admits caller-resolved Ballot Shift only as a bus-free, unscheduled room capability", () => {
    const candidate = ballotShiftRoomCapabilityFixture();
    const before = JSON.stringify(candidate);
    const result = admitLiveRoomCapability(candidate);
    expect(result.status).toBe("admitted");
    if (result.status !== "admitted") throw new Error("Ballot Shift capability must admit");
    expect(result.gameplaySha256).toBe(
      "fea078a46315927d2f145be380ad7f38e6cbfef154e95337fd1ac9c90dcdc2a7",
    );
    expect(result.plan).toMatchObject({
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
      gameplaySha256: result.gameplaySha256,
      room: {
        roomId: "FORCED_ALIGNMENT",
        roomOrdinal: 0,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [{
          patternId: "room.forced.ballot_shift",
          encounterOrdinal: 0,
          difficultySalt: 0x2200,
          resolvedSeed: {domain: "resolved-occurrence-seed", value: 0x63cd_1a1f},
          segments: {readMs: 12_000},
          parallel: {
            mode: "none",
            selectionSeed: {domain: "parallel-selection-seed", value: 0x1234_ba38},
          },
        }],
      },
    });
    expect(result.plan).not.toHaveProperty("rooms");
    expect(result.plan).not.toHaveProperty("boss");
    expect(result.plan).not.toHaveProperty("schedule");
    expect(JSON.stringify(candidate)).toBe(before);
    expectDeepFrozen(result);

    const fullRun = candidateFixture();
    const forcedRoom = (fullRun.rooms as Array<{encounters: Array<Record<string, unknown>>}>)[0];
    if (forcedRoom === undefined) throw new Error("full-Run fixture lost FORCED_ALIGNMENT room");
    forcedRoom.encounters[0] = encounter(0, 0, "room.forced.ballot_shift", 0x2200);
    const fullResult = rejection(admitLiveRun(fullRun));
    expect(fullResult.rejections.length).toBeGreaterThan(0);
    expect(fullResult.rejections.every((entry) => entry.code === "unsupported-pattern")).toBe(true);
    expect(fullResult.rejections).not.toContainEqual(expect.objectContaining({
      path: "$.rooms[0].encounters[0].patternId",
    }));
    expect(fullResult.rejections.some((entry) => entry.path.startsWith("$.boss.phases["))).toBe(true);
  });

  it("pins the fixed left/right execution fixture as admission only", () => {
    const candidate = leftRightGateRoomCapabilityFixture();
    const before = JSON.stringify(candidate);
    const result = admitLiveRoomCapability(candidate);

    expect(result.status).toBe("admitted");
    if (result.status !== "admitted") throw new Error("left/right execution fixture must admit");
    expect(result.gameplaySha256).toBe(
      "b6a1eddf043960a43a3b2af99cadb355932b6ae26fafb9da1563232a642d2d1c",
    );
    expect(result.plan).toMatchObject({
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
      gameplaySha256: result.gameplaySha256,
      room: {
        roomId: "FORCED_ALIGNMENT",
        roomOrdinal: 0,
        tierId: "listen",
        difficulty: "EASY",
        encounters: [{
          patternId: "room.forced.left_right_gate",
          encounterOrdinal: 0,
          difficultySalt: 0x1100,
          resolvedSeed: {domain: "resolved-occurrence-seed", value: 0x7876_34f1},
          segments: {
            telegraphMs: 520,
            entryMs: 800,
            readMs: 10_200,
            materialSettleMs: 1050,
            restMs: 1600,
            safeGapHandoffMs: 520,
          },
          parallel: {
            mode: "none",
            selectionSeed: {domain: "parallel-selection-seed", value: 0x1234_ba38},
          },
        }],
      },
    });
    expect(result.plan).not.toHaveProperty("eventBus");
    expect(result.plan).not.toHaveProperty("composerPlan");
    expect(result.plan).not.toHaveProperty("execution");
    expect(JSON.stringify(candidate)).toBe(before);
    expectDeepFrozen(result);
  });

  it("rejects every omitted room-capability fact instead of filling a default", () => {
    const fixture = roomCapabilityFixture();
    const paths = objectFieldPaths(fixture);
    expect(paths.length).toBeGreaterThan(45);
    for (const path of paths) {
      const candidate = clone(fixture);
      deleteAt(candidate, path);
      const result = roomRejection(admitLiveRoomCapability(candidate));
      expect(
        result.rejections.some((entry) => entry.path === pathText(path) && entry.code === "required"),
        `missing ${pathText(path)}`,
      ).toBe(true);
      expect(result.gameplaySha256).toBeNull();
    }
  });

  it("rejects unsupported room capability only after producing its structural hash", () => {
    const candidate = noDuskGridRoomCapabilityFixture();
    const result = roomRejection(admitLiveRoomCapability(candidate));
    expect(result.gameplaySha256)
      .toBe("cc6c9636b2dd90d8b289d1d68fe7048ea1025c5cf01dea27e6912b047c7307b8");
    expect(result.rejections).toEqual([{
      path: "$.room.encounters[0].patternId",
      code: "unsupported-pattern",
      detail: "room.polarized.no_dusk_grid is not in the exported live-admission combat capability set",
    }]);
  });

  it("reuses exact membership, order, seed, segment, and without-replacement validation", () => {
    const cases: Array<{
      mutate(candidate: Record<string, unknown>): void;
      path: string;
      code: string;
    }> = [
      {
        mutate(candidate) {
          (candidate.room as Record<string, unknown>).roomOrdinal = 1;
        },
        path: "$.room.roomOrdinal",
        code: "room-order",
      },
      {
        mutate(candidate) {
          const room = candidate.room as {encounters: Array<Record<string, unknown>>};
          room.encounters[1] = encounter(0, 1, "room.polarized.alternating_verdict", 0x2201);
        },
        path: "$.room.encounters[1].patternId",
        code: "duplicate",
      },
      {
        mutate(candidate) {
          const room = candidate.room as {encounters: Array<Record<string, unknown>>};
          room.encounters[1] = encounter(0, 1, "room.forced.left_right_gate", 0x2201);
        },
        path: "$.room.encounters[1].patternId",
        code: "pattern-membership",
      },
      {
        mutate(candidate) {
          const room = candidate.room as {encounters: Array<{resolvedSeed: {value: number}}>};
          room.encounters[1]!.resolvedSeed.value = (room.encounters[1]!.resolvedSeed.value + 1) >>> 0;
        },
        path: "$.room.encounters[1].resolvedSeed.value",
        code: "seed-mismatch",
      },
      {
        mutate(candidate) {
          const room = candidate.room as {encounters: Array<{segments: {readMs: number}}>};
          const target = room.encounters[1] as {segments: {readMs: number}};
          target.segments.readMs = target.segments.readMs + 1;
        },
        path: "$.room.encounters[1].segments.readMs",
        code: "pattern-duration",
      },
      {
        mutate(candidate) {
          const room = candidate.room as {encounters: Array<{segments: {restMs: number}}>};
          const target = room.encounters[1] as {segments: {restMs: number}};
          target.segments.restMs = target.segments.restMs - 1;
        },
        path: "$.room.encounters[1].segments.restMs",
        code: "tier-rest",
      },
      {
        mutate(candidate) {
          const room = candidate.room as {encounters: Array<{segments: {safeGapHandoffMs: number}}>};
          const target = room.encounters[1] as {segments: {safeGapHandoffMs: number}};
          target.segments.safeGapHandoffMs = target.segments.safeGapHandoffMs - 1;
        },
        path: "$.room.encounters[1].segments.safeGapHandoffMs",
        code: "safe-gap-handoff",
      },
    ];
    for (const testCase of cases) {
      const candidate = roomCapabilityFixture();
      testCase.mutate(candidate);
      const result = roomRejection(admitLiveRoomCapability(candidate));
      expect(result.gameplaySha256).toBeNull();
      expect(result.rejections).toContainEqual(expect.objectContaining({
        path: testCase.path,
        code: testCase.code,
      }));
    }
  });

  it("shares hostile-data rejection without invoking accessors or traversing holes", () => {
    let reads = 0;
    const accessor = roomCapabilityFixture();
    const room = accessor.room as {encounters: Array<Record<string, unknown>>};
    room.encounters[1] = Object.defineProperty(
      {...room.encounters[1]},
      "patternId",
      {
        enumerable: true,
        get() {
          reads += 1;
          return "room.polarized.hard_cut_corridor";
        },
      },
    );
    expect(roomRejection(admitLiveRoomCapability(accessor)).rejections).toContainEqual(
      expect.objectContaining({path: "$.room.encounters[1].patternId", code: "accessor"}),
    );
    expect(reads).toBe(0);

    const sparse = roomCapabilityFixture();
    const sparseEncounters = new Array(2);
    sparseEncounters[0] = encounter(0, 0, "room.polarized.alternating_verdict", 0x2200);
    (sparse.room as Record<string, unknown>).encounters = sparseEncounters;
    expect(roomRejection(admitLiveRoomCapability(sparse)).rejections).toContainEqual(
      expect.objectContaining({path: "$.room.encounters[1]", code: "required"}),
    );

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const result = roomRejection(admitLiveRoomCapability(revoked.proxy));
    expect(result.rejections).toContainEqual(expect.objectContaining({path: "$", code: "uninspectable"}));
    expectDeepFrozen(result);
  });

  it("sorts hostile rejection paths by Unicode code point instead of UTF-16 units", () => {
    const candidate = roomCapabilityFixture();
    candidate["\u{10000}"] = "astral";
    candidate["\ue000"] = "bmp-private-use";
    const result = roomRejection(admitLiveRoomCapability(candidate));
    expect(result.rejections.filter((entry) => entry.code === "unknown-field").map((entry) => entry.path))
      .toEqual(["$.\ue000", "$.\u{10000}"]);
  });

  it("keeps projection opaque and cannot masquerade as either a composer or full Run", () => {
    const candidate = roomCapabilityFixture();
    const full = admitLiveRoomCapability(candidate, {
      accessibilityProfile: "full",
      weather: {id: "STATIC", seed: 1},
    });
    const reduced = admitLiveRoomCapability(candidate, {
      accessibilityProfile: "flashOff",
      weather: {id: "ECLIPSE", seed: 0xffff_ffff},
    });
    expect(full).toEqual(reduced);
    const revokedProjection = Proxy.revocable({}, {});
    revokedProjection.revoke();
    expect(admitLiveRoomCapability(candidate, revokedProjection.proxy)).toEqual(full);

    const runResult = rejection(admitLiveRun(candidate));
    expect(runResult.gameplaySha256).toBeNull();
    expect(runResult.rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({path: "$.room", code: "unknown-field"}),
      expect.objectContaining({path: "$.rooms", code: "required"}),
      expect.objectContaining({path: "$.boss", code: "required"}),
    ]));
    const roomResult = roomRejection(admitLiveRoomCapability(candidateFixture()));
    expect(roomResult.gameplaySha256).toBeNull();
    expect(roomResult.rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({path: "$.room", code: "required"}),
      expect.objectContaining({path: "$.rooms", code: "unknown-field"}),
      expect.objectContaining({path: "$.boss", code: "unknown-field"}),
    ]));

    const qaLeak = roomCapabilityFixture();
    qaLeak.schedule = [{event: "encounter.begin"}];
    expect(roomRejection(admitLiveRoomCapability(qaLeak)).rejections).toContainEqual(
      expect.objectContaining({path: "$.schedule", code: "unknown-field"}),
    );
    const executionLeak = roomCapabilityFixture();
    executionLeak.composer = true;
    executionLeak.executionScheduled = true;
    expect(roomRejection(admitLiveRoomCapability(executionLeak)).rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({path: "$.composer", code: "unknown-field"}),
        expect.objectContaining({path: "$.executionScheduled", code: "unknown-field"}),
      ]),
    );
  });

  it("pins unchanged full-Run hashing and isolates the admitted pair from its unsupported Boss", () => {
    const baseline = rejection(admitLiveRun(candidateFixture()));
    expect(baseline.gameplaySha256).toBe(
      "61b57932e31d521380219cb1b27357c7198da41ece34aca162423ac56b36b75b",
    );

    const polarized = rejection(admitLiveRun(polarizedFullRunFixture()));
    expect(polarized.gameplaySha256).toBe(
      "d6c6bc63c4657d334f00f2e33cf67b28d9292e87a4ee803f71b84c18519dfa1b",
    );
    expect(polarized.rejections).toEqual([
      expect.objectContaining({path: "$.boss.phases[0].patternId", code: "unsupported-pattern"}),
      expect.objectContaining({path: "$.boss.phases[1].patternId", code: "unsupported-pattern"}),
      expect.objectContaining({path: "$.boss.phases[2].patternId", code: "unsupported-pattern"}),
    ]);
    expect(polarized.rejections.some((entry) => entry.path.startsWith("$.rooms"))).toBe(false);
  });
});

describe("LiveRunAdmission", () => {
  it("pins a bus-free, no-default boundary", () => {
    expect(LIVE_RUN_ADMISSION_CONTRACT).toEqual({
      schemaVersion: "1.0.0-live-run-admission",
      authority: "caller-resolved-live-run",
      rawRunSeedDomain: "raw-run-seed",
      resolvedOccurrenceSeedDomain: "resolved-occurrence-seed",
      parallelSelectionSeedDomain: "parallel-selection-seed",
      canonicalEventBus: false,
      composer: false,
      executionScheduled: false,
      qaDefaultsAccepted: false,
      presentationAffectsHash: false,
    });
    expect(Object.isFrozen(LIVE_RUN_ADMISSION_CONTRACT)).toBe(true);
  });

  it("rejects the current structurally complete plan atomically on capability alone", () => {
    const candidate = candidateFixture();
    const before = JSON.stringify(candidate);
    const result = rejection(admitLiveRun(candidate));
    expect(result.gameplaySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rejections.length).toBeGreaterThan(0);
    expect(result.rejections.every((entry) => entry.code === "unsupported-pattern")).toBe(true);
    const referenced = [
      ...(candidate.rooms as Array<{encounters: Array<{patternId: string}>}>).flatMap((room) =>
        room.encounters.map((entry) => entry.patternId)),
      ...((candidate.boss as {phases: Array<{patternId: string}>}).phases.map((phase) => phase.patternId)),
    ];
    const unsupported = referenced.filter((id) => !SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS.includes(
      id as typeof SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS[number],
    ));
    expect(result.rejections.map((entry) => entry.detail.split(" is not")[0])).toEqual(unsupported.sort());
    expect(result.rejections).not.toContainEqual(expect.objectContaining({
      path: "$.rooms[1].encounters[0].patternId",
    }));
    expect(result.rejections.some((entry) => entry.path.startsWith("$.boss.phases["))).toBe(true);
    expect(JSON.stringify(candidate)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rejections)).toBe(true);
    expect(result.rejections.every(Object.isFrozen)).toBe(true);
  });

  it("rejects every omitted explicit field instead of filling a default", () => {
    const fixture = candidateFixture();
    const paths = objectFieldPaths(fixture);
    expect(paths.length).toBeGreaterThan(60);
    for (const path of paths) {
      const candidate = clone(fixture);
      deleteAt(candidate, path);
      const result = rejection(admitLiveRun(candidate));
      expect(
        result.rejections.some((entry) => entry.path === pathText(path) && entry.code === "required"),
        `missing ${pathText(path)}`,
      ).toBe(true);
      expect(result.gameplaySha256).toBeNull();
    }
  });

  it("does not accept QA room-count, authority, or seed leakage", () => {
    const missingCount = candidateFixture();
    delete missingCount.roomCount;
    missingCount.roomCountAuthority = "qa-oracle-default-3";
    expect(rejection(admitLiveRun(missingCount)).rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({path: "$.roomCount", code: "required"}),
      expect.objectContaining({path: "$.roomCountAuthority", code: "unknown-field"}),
    ]));

    const undefinedCount = candidateFixture();
    undefinedCount.roomCount = undefined;
    expect(rejection(admitLiveRun(undefinedCount)).rejections).toContainEqual(expect.objectContaining({
      path: "$.roomCount",
      code: "integer",
    }));

    const qaAuthority = candidateFixture();
    qaAuthority.authority = "v4-gameplay-tools-sim-core-compose-run";
    expect(rejection(admitLiveRun(qaAuthority)).rejections).toContainEqual(expect.objectContaining({
      path: "$.authority",
      code: "value",
    }));

    const qaSeed = candidateFixture();
    const first = ((qaSeed.rooms as Array<{encounters: Array<Record<string, unknown>>}>)[0]?.encounters[0]);
    expect(first).toBeDefined();
    first!.resolvedSeed = {
      domain: "resolved-occurrence-seed",
      // QA adds roomOrdinal; the live manifest requires the explicit salt instead.
      value: xor(RAW_RUN_SEED, patternById.get(first!.patternId as string)!.seed.base, 0, 0),
    };
    expect(rejection(admitLiveRun(qaSeed)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms[0].encounters[0].resolvedSeed.value",
      code: "seed-mismatch",
    }));

    const qaPlan = composeV4RunComposerPlan({
      rawRunSeed: RAW_RUN_SEED,
      metrics: metrics() as Record<typeof V4_RUN_COMPOSER_METRIC_IDS[number], number>,
      roomCount: 2,
    });
    const qaResult = rejection(admitLiveRun(qaPlan));
    expect(qaResult.gameplaySha256).toBeNull();
    expect(qaResult.rejections.some((entry) => entry.path === "$.rawRunSeed" && entry.code === "required"))
      .toBe(true);
  });

  it("keeps raw, occurrence, and selection seed domains nominally distinct", () => {
    const rawSwap = candidateFixture();
    rawSwap.rawRunSeed = {domain: "resolved-occurrence-seed", value: RAW_RUN_SEED};
    expect(rejection(admitLiveRun(rawSwap)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rawRunSeed.domain",
      code: "value",
    }));

    const occurrenceSwap = candidateFixture();
    const first = ((occurrenceSwap.rooms as Array<{encounters: Array<Record<string, unknown>>}>)[0]!.encounters[0]!);
    first.resolvedSeed = {domain: "raw-run-seed", value: RAW_RUN_SEED};
    expect(rejection(admitLiveRun(occurrenceSwap)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms[0].encounters[0].resolvedSeed.domain",
      code: "value",
    }));

    const selectionSwap = candidateFixture();
    const parallel = ((selectionSwap.rooms as Array<{encounters: Array<{parallel: Record<string, unknown>}>}>)[0]!
      .encounters[0]!.parallel);
    parallel.selectionSeed = {domain: "raw-run-seed", value: RAW_RUN_SEED};
    expect(rejection(admitLiveRun(selectionSwap)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms[0].encounters[0].parallel.selectionSeed.domain",
      code: "value",
    }));

    const ordinalOverflow = candidateFixture();
    ((ordinalOverflow.boss as {phases: Array<Record<string, unknown>>}).phases[0]!).encounterOrdinal = 0x1_0000_0000;
    expect(rejection(admitLiveRun(ordinalOverflow)).rejections).toContainEqual(expect.objectContaining({
      path: "$.boss.phases[0].encounterOrdinal",
      code: "uint32",
    }));
  });

  it("validates exact segment boundaries, tier rest, pattern duration, and safe-gap handoff", () => {
    const maxima = candidateFixture();
    const first = ((maxima.rooms as Array<{encounters: Array<{segments: Record<string, number>}>}>)[0]!
      .encounters[0]!.segments);
    first.telegraphMs = 900;
    first.entryMs = 1600;
    first.materialSettleMs = 1800;
    structurallyComplete(admitLiveRun(maxima));

    const cases: Array<[string, number, string]> = [
      ["telegraphMs", 519, "segment-range"],
      ["entryMs", 1601, "segment-range"],
      ["materialSettleMs", 1801, "segment-range"],
      ["restMs", 1599, "tier-rest"],
      ["safeGapHandoffMs", 519, "safe-gap-handoff"],
      ["readMs", first.readMs! + 1, "pattern-duration"],
    ];
    for (const [field, value, code] of cases) {
      const candidate = candidateFixture();
      const target = ((candidate.rooms as Array<{encounters: Array<{segments: Record<string, number>}>}>)[0]!
        .encounters[0]!.segments);
      target[field] = value;
      expect(rejection(admitLiveRun(candidate)).rejections).toContainEqual(expect.objectContaining({
        path: `$.rooms[0].encounters[0].segments.${field}`,
        code,
      }));
    }
  });

  it("accepts only explicit none or an authored parallel member and never weather input", () => {
    const candidate = candidateFixture();
    const primary = ((candidate.rooms as Array<{encounters: Array<Record<string, unknown>>}>)[0]!.encounters[0]!);
    const patternId = "encounter.weather_echo.rain_packets";
    const salt = 0x4400;
    primary.parallel = {
      mode: "member",
      occurrenceId: "parallel:0:0:rain",
      patternId,
      difficulty: "EASY",
      difficultySalt: salt,
      resolvedSeed: resolvedSeed(patternId, 0, salt),
      selectionSeed: selectionSeed(0),
    };
    const result = rejection(admitLiveRun(candidate));
    expect(result.gameplaySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rejections).not.toContainEqual(expect.objectContaining({
      path: "$.rooms[0].encounters[0].parallel.patternId",
    }));
    expect(result.rejections.some((entry) => entry.code === "unsupported-pattern")).toBe(true);

    const weatherLeak = clone(candidate);
    ((weatherLeak.rooms as Array<{encounters: Array<{parallel: Record<string, unknown>}>}>)[0]!
      .encounters[0]!.parallel).weatherSeed = 99;
    const leaked = rejection(admitLiveRun(weatherLeak));
    expect(leaked.gameplaySha256).toBeNull();
    expect(leaked.rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms[0].encounters[0].parallel.weatherSeed",
      code: "unknown-field",
    }));

    const wrongMember = clone(candidate);
    ((wrongMember.rooms as Array<{encounters: Array<{parallel: Record<string, unknown>}>}>)[0]!
      .encounters[0]!.parallel).patternId = "common.eye_acquisition";
    expect(rejection(admitLiveRun(wrongMember)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms[0].encounters[0].parallel.patternId",
      code: "parallel-membership",
    }));
  });

  it("requires the complete explicit Boss choice and ordered phase binding", () => {
    const missingPhase = candidateFixture();
    (missingPhase.boss as {phases: unknown[]}).phases.pop();
    expect(rejection(admitLiveRun(missingPhase)).rejections).toContainEqual(expect.objectContaining({
      path: "$.boss.phases",
      code: "boss-phases",
    }));

    const swapped = candidateFixture();
    const phases = (swapped.boss as {phases: Array<Record<string, unknown>>}).phases;
    [phases[0], phases[1]] = [phases[1]!, phases[0]!];
    expect(rejection(admitLiveRun(swapped)).rejections).toContainEqual(expect.objectContaining({
      path: "$.boss.phases[0]",
      code: "boss-phase-binding",
    }));

    const wrongRoom = candidateFixture();
    wrongRoom.boss = bossFixture("boss.no_dusk");
    expect(rejection(admitLiveRun(wrongRoom)).rejections).toContainEqual(expect.objectContaining({
      path: "$.boss.bossId",
      code: "boss-room",
    }));
  });

  it("never invokes accessors and rejects symbols, custom prototypes, and non-enumerable fields", () => {
    let reads = 0;
    const accessor = candidateFixture();
    accessor.rawRunSeed = Object.defineProperties({}, {
      domain: {value: "raw-run-seed", enumerable: true},
      value: {
        enumerable: true,
        get() {
          reads += 1;
          return RAW_RUN_SEED;
        },
      },
    });
    expect(rejection(admitLiveRun(accessor)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rawRunSeed.value",
      code: "accessor",
    }));
    expect(reads).toBe(0);

    const symbol = candidateFixture();
    (symbol.metricSnapshot as Record<PropertyKey, unknown>)[Symbol("hidden")] = 1;
    expect(rejection(admitLiveRun(symbol)).rejections).toContainEqual(expect.objectContaining({
      path: "$.metricSnapshot",
      code: "symbol-key",
    }));

    const prototype = candidateFixture();
    Object.setPrototypeOf(prototype, {governance: "hidden"});
    expect(rejection(admitLiveRun(prototype)).rejections).toContainEqual(expect.objectContaining({
      path: "$",
      code: "prototype",
    }));

    const hidden = candidateFixture();
    Object.defineProperty(hidden.rooms, "secret", {value: 1, enumerable: false});
    expect(rejection(admitLiveRun(hidden)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms.secret",
      code: "unknown-field",
    }));
  });

  it("converts revoked proxies into frozen rejection ledgers", () => {
    const revokedRoot = Proxy.revocable({}, {});
    revokedRoot.revoke();
    const rootResult = rejection(admitLiveRun(revokedRoot.proxy));
    expect(rootResult.rejections).toContainEqual(expect.objectContaining({
      path: "$",
      code: "uninspectable",
    }));
    expectDeepFrozen(rootResult);

    const revokedRooms = Proxy.revocable([], {});
    revokedRooms.revoke();
    const candidate = candidateFixture();
    candidate.rooms = revokedRooms.proxy;
    const nestedResult = rejection(admitLiveRun(candidate));
    expect(nestedResult.rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms",
      code: "uninspectable",
    }));
    expectDeepFrozen(nestedResult);
  });

  it("bounds sparse arrays and rejects numeric metadata outside their declared length", () => {
    const sparse = candidateFixture();
    let farEntryInspections = 0;
    const farEntry = new Proxy({}, {
      getPrototypeOf() {
        farEntryInspections += 1;
        return Object.prototype;
      },
    });
    const oversized: unknown[] = new Array(100);
    oversized[99] = farEntry;
    sparse.rooms = oversized;
    expect(rejection(admitLiveRun(sparse)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms.length",
      code: "array-length",
    }));
    expect(farEntryInspections).toBe(0);

    const numericMetadata = candidateFixture();
    Object.defineProperty(numericMetadata.rooms, "4294967295", {
      value: {hidden: true},
      enumerable: true,
    });
    expect(rejection(admitLiveRun(numericMetadata)).rejections).toContainEqual(expect.objectContaining({
      path: "$.rooms.4294967295",
      code: "unknown-field",
    }));
  });

  it("sorts rejection ledgers independently of caller key order", () => {
    const first = rejection(admitLiveRun({z: 1, a: 2}));
    const second = rejection(admitLiveRun({a: 2, z: 1}));
    expect(first.rejections).toEqual(second.rejections);
    const sorted = first.rejections.slice().sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1
        : left.code < right.code ? -1 : left.code > right.code ? 1 : 0);
    expect(first.rejections).toEqual(sorted);
  });

  it("keeps accessibility and presentation weather outside the gameplay hash", () => {
    const candidate = candidateFixture();
    const full = admitLiveRun(candidate, {
      accessibilityProfile: "full",
      weather: {id: "STATIC", seed: 1},
    });
    const reduced = admitLiveRun(candidate, {
      accessibilityProfile: "flashOff",
      weather: {id: "ECLIPSE", seed: 0xffff_ffff},
    });
    expect(structurallyComplete(full)).toBe(structurallyComplete(reduced));
    expect(full).toEqual(reduced);

    const revokedProjection = Proxy.revocable({}, {});
    revokedProjection.revoke();
    expect(admitLiveRun(candidate, revokedProjection.proxy)).toEqual(full);
    expect(admitLiveRun(candidate, {accessibilityProfile: "unknown", weather: {authority: "hostile"}}))
      .toEqual(full);

    const gameplayLeak = candidateFixture();
    gameplayLeak.presentationWeather = {id: "RAIN", seed: 1};
    expect(rejection(admitLiveRun(gameplayLeak)).rejections).toContainEqual(expect.objectContaining({
      path: "$.presentationWeather",
      code: "unknown-field",
    }));
  });

  it("rejects QA pseudo-events without a production event-bus dependency", async () => {
    const bus = new CanonicalEventBus();
    const candidate = candidateFixture();
    candidate.schedule = [
      {event: "room.enter"},
      {event: "encounter.begin"},
      {event: "material.settle"},
      {event: "dusk.begin"},
    ];
    const result = rejection(admitLiveRun(candidate));
    expect(result.gameplaySha256).toBeNull();
    expect(result.rejections).toContainEqual(expect.objectContaining({
      path: "$.schedule",
      code: "unknown-field",
    }));
    expect(bus.events()).toEqual([]);
    expect(bus.canonicalSerialization()).toBe("[]");
    expect(JSON.stringify(result)).not.toContain("room.enter");
    const source = await readFile(new URL("./live-run-admission.ts", import.meta.url), "utf8");
    expect(source).not.toContain('from "./events"');
    expect(source).not.toContain("CanonicalEventBus");
    expect(source).not.toContain("composeV4RunComposerPlan");
    expect(source).not.toContain("RoomTransitionAuthority");
  });

  it("returns a recursively frozen admitted plan when capability proof is complete", async () => {
    vi.resetModules();
    vi.doMock("./combat-kernel", () => ({
      SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS: Object.freeze(
        executablePatternsJson.patterns.map((pattern) => pattern.id),
      ),
    }));
    try {
      const isolated = await import("./live-run-admission");
      const result = isolated.admitLiveRun(candidateFixture());
      expect(result.status).toBe("admitted");
      if (result.status !== "admitted") throw new Error("complete capability proof must admit the plan");
      expect(result.gameplaySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.plan.gameplaySha256).toBe(result.gameplaySha256);
      expect(result.plan.canonicalEventBus).toBe(false);
      expect(result.plan.composer).toBe(false);
      expect(result.plan.executionScheduled).toBe(false);
      expectDeepFrozen(result);
    } finally {
      vi.doUnmock("./combat-kernel");
      vi.resetModules();
    }
  });
});
