import {assertFiniteDuration, EventTrace, JsonValue} from "./events.js";

export type BossPhaseExit =
  | {readonly kind: "hp-ratio-lte"; readonly value: number}
  | {readonly kind: "survive-ms"; readonly value: number}
  | {readonly kind: "fact"; readonly factId: string};

export interface BossPhaseDefinition {
  readonly id: string;
  readonly attackPlanId: string;
  readonly exit: BossPhaseExit;
}

export type BossState = "idle" | "active" | "resolved";

/** Supports destruction, survival, and fact-based non-combat resolutions. */
export class BossPhaseMachine {
  state: BossState = "idle";
  phaseIndex = -1;
  generation = 0;
  private phaseEnteredAtMs = 0;

  constructor(
    private readonly trace: EventTrace,
    readonly bossId: string,
    readonly phases: readonly BossPhaseDefinition[],
  ) {
    if (!bossId) throw new Error("boss id is required");
    if (phases.length < 1) throw new Error("boss requires at least one phase");
    const ids = new Set<string>();
    for (const phase of phases) {
      if (!phase.id || !phase.attackPlanId) throw new Error("boss phase id and attack plan are required");
      if (ids.has(phase.id)) throw new Error(`duplicate boss phase id: ${phase.id}`);
      ids.add(phase.id);
      if (phase.exit.kind === "hp-ratio-lte" && (phase.exit.value < 0 || phase.exit.value > 1)) {
        throw new Error("boss hp ratio threshold must be in [0,1]");
      }
      if (phase.exit.kind === "survive-ms") assertFiniteDuration(phase.exit.value, "boss survival duration");
      if (phase.exit.kind === "fact" && !phase.exit.factId) throw new Error("boss fact exit requires factId");
    }
  }

  start(atMs: number): void {
    assertFiniteDuration(atMs, "boss start time");
    if (this.state === "active") throw new Error("boss encounter is already active");
    this.generation += 1;
    this.state = "active";
    this.phaseIndex = 0;
    this.phaseEnteredAtMs = atMs;
    this.trace.emit("boss.encounter.begin", atMs, {
      bossId: this.bossId,
      generation: this.generation,
      phaseCount: this.phases.length,
    }, this.key("encounter-begin"));
    this.emitPhaseEntry(atMs);
  }

  update(atMs: number, hpRatio: number, facts: ReadonlySet<string> = new Set<string>()): void {
    assertFiniteDuration(atMs, "boss update time");
    if (!Number.isFinite(hpRatio) || hpRatio < 0 || hpRatio > 1) {
      throw new Error("boss hp ratio must be in [0,1]");
    }
    if (this.state !== "active") return;

    for (let traversed = 0; traversed < this.phases.length; traversed += 1) {
      const phase = this.phases[this.phaseIndex];
      if (!phase) throw new Error("boss phase index is invalid");
      if (!this.exitSatisfied(phase.exit, atMs, hpRatio, facts)) return;

      this.trace.emit("boss.phase.exit", atMs, {
        bossId: this.bossId,
        generation: this.generation,
        phaseId: phase.id,
        cause: phase.exit.kind,
      }, this.key(`phase-exit:${phase.id}`));

      if (this.phaseIndex === this.phases.length - 1) {
        this.state = "resolved";
        this.trace.emit("boss.encounter.resolve", atMs, {
          bossId: this.bossId,
          generation: this.generation,
          outcome: phase.exit.kind,
          finalPhaseId: phase.id,
        }, this.key("resolve"));
        return;
      }

      const previousId = phase.id;
      this.phaseIndex += 1;
      this.phaseEnteredAtMs = atMs;
      const next = this.phases[this.phaseIndex];
      if (!next) throw new Error("boss next phase is missing");
      this.trace.emit("boss.phase.swap", atMs, {
        bossId: this.bossId,
        generation: this.generation,
        fromPhaseId: previousId,
        toPhaseId: next.id,
      }, this.key(`phase-swap:${next.id}`));
      this.emitPhaseEntry(atMs);
    }
    throw new Error("boss crossed more phase boundaries than declared");
  }

  private exitSatisfied(
    exit: BossPhaseExit,
    atMs: number,
    hpRatio: number,
    facts: ReadonlySet<string>,
  ): boolean {
    if (exit.kind === "hp-ratio-lte") return hpRatio <= exit.value;
    if (exit.kind === "survive-ms") return atMs - this.phaseEnteredAtMs >= exit.value;
    return facts.has(exit.factId);
  }

  private emitPhaseEntry(atMs: number): void {
    const phase = this.phases[this.phaseIndex];
    if (!phase) throw new Error("boss phase entry is missing");
    this.trace.emit("boss.phase.enter", atMs, {
      bossId: this.bossId,
      generation: this.generation,
      phaseId: phase.id,
      phaseIndex: this.phaseIndex,
    }, this.key(`phase-enter:${phase.id}`));
    this.trace.emit("boss.phase.attack_plan.commit", atMs, {
      bossId: this.bossId,
      generation: this.generation,
      phaseId: phase.id,
      attackPlanId: phase.attackPlanId,
    }, this.key(`attack-plan:${phase.id}`));
  }

  private key(suffix: string): string {
    return `${this.bossId}:${this.generation}:${suffix}`;
  }
}

export type WeatherType = "STATIC" | "RAIN" | "GLITCH" | "ASH" | "WIND" | "ECLIPSE";
export type WeatherState = "clear" | "omen" | "active" | "aftermath" | "cooldown";

export interface WeatherDurations {
  readonly omenMs: number;
  readonly activeMs: number;
  readonly aftermathMs: number;
  readonly cooldownMs: number;
}

export class WeatherMachine {
  state: WeatherState = "clear";
  weather: WeatherType | undefined;
  cycle = 0;
  private deadlineMs: number | undefined;
  private durations: WeatherDurations | undefined;

  constructor(private readonly trace: EventTrace) {}

  request(weather: WeatherType, atMs: number, durations: WeatherDurations): boolean {
    assertFiniteDuration(atMs, "weather request time");
    if (this.state !== "clear") return false;
    for (const [label, value] of Object.entries(durations)) assertFiniteDuration(value, `weather ${label}`);
    this.cycle += 1;
    this.weather = weather;
    this.durations = Object.freeze({...durations});
    this.state = "omen";
    this.deadlineMs = atMs + durations.omenMs;
    this.trace.emit("weather.omen.begin", atMs, {
      weather,
      cycle: this.cycle,
      activeAtMs: this.deadlineMs,
    }, this.key("omen"));
    if (durations.omenMs === 0) this.advance(atMs);
    return true;
  }

  advance(toMs: number): void {
    assertFiniteDuration(toMs, "weather advance time");
    for (let boundary = 0; boundary < 5; boundary += 1) {
      if (!this.weather || !this.durations || this.deadlineMs === undefined || toMs < this.deadlineMs) return;
      const due = this.deadlineMs;
      const weather = this.weather;
      if (this.state === "omen") {
        this.state = "active";
        this.deadlineMs = due + this.durations.activeMs;
        this.trace.emit("weather.active.begin", due, {weather, cycle: this.cycle}, this.key("active"));
        continue;
      }
      if (this.state === "active") {
        this.state = "aftermath";
        this.deadlineMs = due + this.durations.aftermathMs;
        this.trace.emit("weather.aftermath.begin", due, {weather, cycle: this.cycle}, this.key("aftermath"));
        continue;
      }
      if (this.state === "aftermath") {
        this.state = "cooldown";
        this.deadlineMs = due + this.durations.cooldownMs;
        this.trace.emit("weather.cooldown.begin", due, {weather, cycle: this.cycle}, this.key("cooldown"));
        continue;
      }
      if (this.state === "cooldown") {
        this.trace.emit("weather.complete", due, {weather, cycle: this.cycle}, this.key("complete"));
        this.state = "clear";
        this.weather = undefined;
        this.durations = undefined;
        this.deadlineMs = undefined;
        return;
      }
      return;
    }
    throw new Error("weather crossed too many boundaries in one advance");
  }

  private key(suffix: string): string {
    return `weather:${this.cycle}:${suffix}`;
  }
}

export type MaterialRecord = Readonly<Record<string, JsonValue>>;

export interface MaterialMemoryGroups {
  readonly overrideScars: readonly MaterialRecord[];
  readonly deathTraces: readonly MaterialRecord[];
  readonly burnIns: readonly MaterialRecord[];
  readonly ghostResidues: readonly MaterialRecord[];
}

export interface GhostRoutePoint {
  readonly tMs: number;
  readonly xNorm: number;
  readonly yNorm: number;
  readonly room: string;
  readonly flower: number;
  readonly focus: boolean;
  readonly flags: readonly string[];
}

export interface GhostRoute {
  readonly routeDigest: string;
  readonly points: readonly GhostRoutePoint[];
}

export interface SnapshotRecord {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly deterministicSeed: string;
  readonly metrics: Readonly<Record<string, JsonValue>>;
  readonly materialMemory: MaterialMemoryGroups;
  readonly ghostRoute: GhostRoute;
}

function validateGhostRoute(route: GhostRoute): number {
  if (!route.routeDigest) throw new Error("ghost route digest is required");
  if (route.points.length < 1) throw new Error("cross-run restore requires a captured ghost route");
  let previous = -1;
  for (const [index, point] of route.points.entries()) {
    if (!Number.isInteger(point.tMs) || point.tMs < 0 || point.tMs <= previous) {
      if (!(index === 0 && point.tMs === 0)) {
        throw new Error("ghost route timestamps must start at zero and increase strictly");
      }
    }
    if (index === 0 && point.tMs !== 0) throw new Error("ghost route must begin at tMs=0");
    if (![point.xNorm, point.yNorm, point.flower].every((value) =>
      Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error("ghost route normalized values must be in [0,1]");
    }
    if (!point.room) throw new Error("ghost route point room is required");
    previous = point.tMs;
  }
  return route.points[route.points.length - 1]?.tMs ?? 0;
}

function freezeMaterialRecords(records: readonly MaterialRecord[]): readonly MaterialRecord[] {
  return Object.freeze(records.map((record) => Object.freeze({...record})));
}

function freezeSnapshotRecord(record: SnapshotRecord): SnapshotRecord {
  validateGhostRoute(record.ghostRoute);
  const points = Object.freeze(record.ghostRoute.points.map((point) => Object.freeze({
    ...point,
    flags: Object.freeze([...point.flags]),
  })));
  return Object.freeze({
    ...record,
    metrics: Object.freeze({...record.metrics}),
    materialMemory: Object.freeze({
      overrideScars: freezeMaterialRecords(record.materialMemory.overrideScars),
      deathTraces: freezeMaterialRecords(record.materialMemory.deathTraces),
      burnIns: freezeMaterialRecords(record.materialMemory.burnIns),
      ghostResidues: freezeMaterialRecords(record.materialMemory.ghostResidues),
    }),
    ghostRoute: Object.freeze({routeDigest: record.ghostRoute.routeDigest, points}),
  });
}

export function ghostRouteDurationMs(record: SnapshotRecord): number {
  return validateGhostRoute(record.ghostRoute);
}

function materialCounts(memory: MaterialMemoryGroups): Readonly<Record<string, JsonValue>> {
  return {
    overrideScars: memory.overrideScars.length,
    deathTraces: memory.deathTraces.length,
    burnIns: memory.burnIns.length,
    ghostResidues: memory.ghostResidues.length,
  };
}

export const SNAPSHOT_TIMING = Object.freeze({
  serializeAtMs: 410,
  presentAtMs: 810,
  completeAtMs: 1630,
});

export type SnapshotState = "idle" | "capturing" | "serialized" | "presenting" | "complete";

/** End-of-run observation. It does not perform next-run restoration. */
export class SnapshotMachine {
  state: SnapshotState = "idle";
  serializedRecord: SnapshotRecord | undefined;
  private startedAtMs = 0;
  private record: SnapshotRecord | undefined;

  constructor(private readonly trace: EventTrace) {}

  begin(record: SnapshotRecord, atMs: number): void {
    assertFiniteDuration(atMs, "snapshot start time");
    if (this.state !== "idle") throw new Error("snapshot already started");
    if (!record.runId || !record.snapshotHash || !record.deterministicSeed) {
      throw new Error("snapshot record is incomplete");
    }
    this.record = freezeSnapshotRecord(record);
    this.startedAtMs = atMs;
    this.state = "capturing";
    this.trace.emit("snapshot.begin", atMs, {runId: record.runId}, this.key("begin"));
  }

  advance(toMs: number): void {
    assertFiniteDuration(toMs, "snapshot advance time");
    const record = this.record;
    if (!record) return;
    if (this.state === "capturing" && toMs >= this.startedAtMs + SNAPSHOT_TIMING.serializeAtMs) {
      const due = this.startedAtMs + SNAPSHOT_TIMING.serializeAtMs;
      this.serializedRecord = record;
      this.state = "serialized";
      this.trace.emit("snapshot.serialize.commit", due, {
        runId: record.runId,
        snapshotHash: record.snapshotHash,
        deterministicSeed: record.deterministicSeed,
        routeDigest: record.ghostRoute.routeDigest,
        routeDurationMs: ghostRouteDurationMs(record),
        materialCounts: materialCounts(record.materialMemory),
      }, this.key("serialize"));
    }
    if (this.state === "serialized" && toMs >= this.startedAtMs + SNAPSHOT_TIMING.presentAtMs) {
      const due = this.startedAtMs + SNAPSHOT_TIMING.presentAtMs;
      this.state = "presenting";
      this.trace.emit("snapshot.present.begin", due, {
        runId: record.runId,
        snapshotHash: record.snapshotHash,
      }, this.key("present"));
    }
    if (this.state === "presenting" && toMs >= this.startedAtMs + SNAPSHOT_TIMING.completeAtMs) {
      const due = this.startedAtMs + SNAPSHOT_TIMING.completeAtMs;
      this.state = "complete";
      this.trace.emit("snapshot.complete", due, {runId: record.runId}, this.key("complete"));
    }
  }

  private key(suffix: string): string {
    return `snapshot:${this.record?.runId ?? "missing"}:${suffix}`;
  }
}

/** Persistence is explicit and separate from both snapshot presentation and restore. */
export class CrossRunArchive {
  private readonly records = new Map<string, SnapshotRecord>();

  constructor(private readonly trace: EventTrace) {}

  persist(record: SnapshotRecord, atMs: number): void {
    assertFiniteDuration(atMs, "cross-run persistence time");
    if (this.records.has(record.runId)) throw new Error(`run is already persisted: ${record.runId}`);
    const frozen = freezeSnapshotRecord(record);
    this.records.set(record.runId, frozen);
    this.trace.emit("cross_run.record.persist.commit", atMs, {
      runId: record.runId,
      snapshotHash: record.snapshotHash,
      deterministicSeed: record.deterministicSeed,
      routeDigest: record.ghostRoute.routeDigest,
      routeDurationMs: ghostRouteDurationMs(record),
      materialCounts: materialCounts(record.materialMemory),
    }, `cross-run:persist:${record.runId}`);
  }

  get(runId: string): SnapshotRecord | undefined {
    return this.records.get(runId);
  }
}

export const CROSS_RUN_RESTORE_OFFSETS = Object.freeze({
  materialRehydrateAtMs: 0,
  ghostReplayBeginAtMs: 420,
  ghostReplayCompleteOffsetMs: 420,
  ghostResidueWriteOffsetMs: 421,
  witnessTurnOffsetMs: 700,
  inputReturnOffsetMs: 1140,
});

export interface CrossRunRestoreTiming {
  readonly materialRehydrateAtMs: number;
  readonly ghostReplayBeginAtMs: number;
  readonly ghostReplayCompleteAtMs: number;
  readonly ghostResidueWriteAtMs: number;
  readonly witnessTurnAtMs: number;
  readonly inputReturnAtMs: number;
}

export function deriveCrossRunRestoreTiming(routeDurationMs: number): CrossRunRestoreTiming {
  assertFiniteDuration(routeDurationMs, "ghost route duration");
  return Object.freeze({
    materialRehydrateAtMs: CROSS_RUN_RESTORE_OFFSETS.materialRehydrateAtMs,
    ghostReplayBeginAtMs: CROSS_RUN_RESTORE_OFFSETS.ghostReplayBeginAtMs,
    ghostReplayCompleteAtMs: routeDurationMs + CROSS_RUN_RESTORE_OFFSETS.ghostReplayCompleteOffsetMs,
    ghostResidueWriteAtMs: routeDurationMs + CROSS_RUN_RESTORE_OFFSETS.ghostResidueWriteOffsetMs,
    witnessTurnAtMs: routeDurationMs + CROSS_RUN_RESTORE_OFFSETS.witnessTurnOffsetMs,
    inputReturnAtMs: routeDurationMs + CROSS_RUN_RESTORE_OFFSETS.inputReturnOffsetMs,
  });
}

export type CrossRunRestoreState =
  | "idle"
  | "waiting-ghost"
  | "replaying-ghost"
  | "materializing-residue"
  | "waiting-witness"
  | "orienting-witnesses"
  | "ready";

/** Four typed materials and the actual route keep distinct semantics and clocks. */
export class CrossRunRestoreMachine {
  state: CrossRunRestoreState = "idle";
  private startedAtMs = 0;
  private record: SnapshotRecord | undefined;
  private nextStep = 0;
  private restoreTiming: CrossRunRestoreTiming | undefined;
  private routeDurationMs = 0;
  private replayRoutePoints: readonly Readonly<Record<string, JsonValue>>[] = [];
  private finalRoutePoint: GhostRoutePoint | undefined;

  constructor(private readonly trace: EventTrace, readonly nextRunId: string) {
    if (!nextRunId) throw new Error("next run id is required");
  }

  begin(record: SnapshotRecord, atMs: number): void {
    assertFiniteDuration(atMs, "cross-run restore start time");
    if (this.state !== "idle") throw new Error("cross-run restore already started");
    const frozen = freezeSnapshotRecord(record);
    this.record = frozen;
    this.startedAtMs = atMs;
    this.nextStep = 0;
    this.state = "waiting-ghost";
    const routeDurationMs = ghostRouteDurationMs(frozen);
    const finalPoint = frozen.ghostRoute.points[frozen.ghostRoute.points.length - 1];
    if (!finalPoint) throw new Error("ghost route final point is missing");
    this.routeDurationMs = routeDurationMs;
    this.restoreTiming = deriveCrossRunRestoreTiming(routeDurationMs);
    this.finalRoutePoint = finalPoint;
    this.replayRoutePoints = Object.freeze(frozen.ghostRoute.points.map((point) => Object.freeze({
      tMs: point.tMs,
      xNorm: point.xNorm,
      yNorm: point.yNorm,
      room: point.room,
      flower: point.flower,
      focus: point.focus,
      flags: point.flags,
    })));
    this.trace.emit("player.input.off", atMs, {reason: "cross-run-restore"}, this.key("input-off"));
    this.trace.emit("cross_run.restore.begin", atMs, {
      fromRunId: frozen.runId,
      nextRunId: this.nextRunId,
      routeDigest: frozen.ghostRoute.routeDigest,
      routeDurationMs,
    }, this.key("begin"));
    this.trace.emit("overrideScar.rehydrate", atMs, {
      fromRunId: frozen.runId,
      nextRunId: this.nextRunId,
      recordType: "overrideScar",
      count: frozen.materialMemory.overrideScars.length,
      records: frozen.materialMemory.overrideScars,
    }, this.key("override-scar-rehydrate"));
    this.trace.emit("deathTrace.rehydrate", atMs, {
      fromRunId: frozen.runId,
      nextRunId: this.nextRunId,
      recordType: "deathTrace",
      count: frozen.materialMemory.deathTraces.length,
      records: frozen.materialMemory.deathTraces,
    }, this.key("death-trace-rehydrate"));
    this.trace.emit("burnIn.rehydrate", atMs, {
      fromRunId: frozen.runId,
      nextRunId: this.nextRunId,
      recordType: "burnIn",
      count: frozen.materialMemory.burnIns.length,
      records: frozen.materialMemory.burnIns,
    }, this.key("burn-in-rehydrate"));
  }

  advance(toMs: number): void {
    assertFiniteDuration(toMs, "cross-run restore advance time");
    const record = this.record;
    if (!record || this.state === "ready") return;
    const timing = this.restoreTiming;
    const finalPoint = this.finalRoutePoint;
    if (!timing || !finalPoint) throw new Error("cross-run restore schedule is missing");
    const routeDurationMs = this.routeDurationMs;
    const routePoints = this.replayRoutePoints;
    const steps = [
      {at: timing.ghostReplayBeginAtMs, run: (due: number) => {
        this.state = "replaying-ghost";
        this.trace.emit("ghost.replay.begin", due, {
          fromRunId: record.runId,
          nextRunId: this.nextRunId,
          routeDigest: record.ghostRoute.routeDigest,
          routeDurationMs,
          pointCount: routePoints.length,
          routePoints,
          timeScale: 1,
          collisionClass: "NONE",
          rewardClass: "NONE",
          emitterClass: "NONE",
        }, this.key("ghost-replay-begin"));
      }},
      {at: timing.ghostReplayCompleteAtMs, run: (due: number) => {
        this.state = "materializing-residue";
        this.trace.emit("ghost.replay.complete", due, {
          fromRunId: record.runId,
          nextRunId: this.nextRunId,
          routeDigest: record.ghostRoute.routeDigest,
          routeDurationMs,
          finalPoint: {
            tMs: finalPoint.tMs,
            xNorm: finalPoint.xNorm,
            yNorm: finalPoint.yNorm,
            room: finalPoint.room,
          },
          burnAfterRead: true,
        }, this.key("ghost-replay-complete"));
      }},
      {at: timing.ghostResidueWriteAtMs, run: (due: number) => {
        this.state = "waiting-witness";
        this.trace.emit("ghost.residue.write", due, {
          fromRunId: record.runId,
          nextRunId: this.nextRunId,
          recordType: "ghostResidue",
          residueId: `ghost-residue:${record.runId}:${this.nextRunId}`,
          sourceRouteDigest: record.ghostRoute.routeDigest,
          createdAfterReplay: true,
          persistenceRuns: 1,
          position: {room: finalPoint.room, xNorm: finalPoint.xNorm, yNorm: finalPoint.yNorm},
          priorGhostResidueCount: record.materialMemory.ghostResidues.length,
        }, this.key("ghost-residue-write"));
      }},
      {at: timing.witnessTurnAtMs, run: (due: number) => {
        this.state = "orienting-witnesses";
        this.trace.emit("witness.turn", due, {
          fromRunId: record.runId,
          nextRunId: this.nextRunId,
          evaluatedAfterGhostResidue: true,
          overrideScarIds: record.materialMemory.overrideScars.map((item) => String(item.id ?? "")),
          ghostEndpoint: {room: finalPoint.room, xNorm: finalPoint.xNorm, yNorm: finalPoint.yNorm},
          priority: ["nearbyOverrideScar", "ghostEndpoint", "resistanceTransmission", "eclipse", "resonance", "clamp", "idle"],
        }, this.key("witness-turn"));
      }},
      {at: timing.inputReturnAtMs, run: (due: number) => {
        this.state = "ready";
        this.trace.emit("returnInput", due, {
          fromRunId: record.runId,
          nextRunId: this.nextRunId,
          inputState: "enabled",
          routeDurationMs,
        }, this.key("return-input"));
        this.trace.emit("cross_run.restore.complete", due, {
          fromRunId: record.runId,
          nextRunId: this.nextRunId,
          routeDigest: record.ghostRoute.routeDigest,
          routeDurationMs,
        }, this.key("complete"));
      }},
    ] as const;

    while (this.nextStep < steps.length) {
      const step = steps[this.nextStep];
      if (!step) throw new Error("cross-run restore step is missing");
      const due = this.startedAtMs + step.at;
      if (toMs < due) return;
      step.run(due);
      this.nextStep += 1;
    }
  }

  private key(suffix: string): string {
    return `cross-run:${this.record?.runId ?? "missing"}:${this.nextRunId}:${suffix}`;
  }
}

export type RoomId = "INFORMATION" | "FORCED_ALIGNMENT" | "IN_BETWEEN" | "POLARIZED";

/** Input-only migration boundary; all emitted room IDs are canonical. */
export function canonicalizeRoomId(value: string): RoomId {
  if (value === "INFO_OVERFLOW") return "INFORMATION";
  if (value === "INFORMATION"
    || value === "FORCED_ALIGNMENT"
    || value === "IN_BETWEEN"
    || value === "POLARIZED") return value;
  throw new Error(`unknown room id: ${value}`);
}

export type RoomTransitionState = "idle" | "preparing" | "swapping" | "stabilizing";

export interface RoomTransitionTiming {
  readonly worldSwapAtMs: number;
  readonly roomReadyAtMs: number;
  readonly completeAtMs: number;
}

export const ROOM_TRANSITION_TIMING: RoomTransitionTiming = Object.freeze({
  worldSwapAtMs: 240,
  roomReadyAtMs: 500,
  completeAtMs: 650,
});

export class RoomTransitionMachine {
  state: RoomTransitionState = "idle";
  currentRoom: RoomId;
  private targetRoom: RoomId | undefined;
  private startedAtMs = 0;
  private generation = 0;

  constructor(private readonly trace: EventTrace, initialRoom: RoomId) {
    this.currentRoom = initialRoom;
  }

  request(targetRoom: RoomId, atMs: number): boolean {
    assertFiniteDuration(atMs, "room transition request time");
    if (this.state !== "idle" || targetRoom === this.currentRoom) return false;
    this.generation += 1;
    this.targetRoom = targetRoom;
    this.startedAtMs = atMs;
    this.state = "preparing";
    this.trace.emit("room.transition.begin", atMs, {
      generation: this.generation,
      fromRoom: this.currentRoom,
      toRoom: targetRoom,
    }, this.key("begin"));
    return true;
  }

  advance(toMs: number): void {
    assertFiniteDuration(toMs, "room transition advance time");
    const target = this.targetRoom;
    if (!target || this.state === "idle") return;
    if (this.state === "preparing" && toMs >= this.startedAtMs + ROOM_TRANSITION_TIMING.worldSwapAtMs) {
      const due = this.startedAtMs + ROOM_TRANSITION_TIMING.worldSwapAtMs;
      const from = this.currentRoom;
      this.currentRoom = target;
      this.state = "swapping";
      this.trace.emit("room.transition.world_swap.commit", due, {
        generation: this.generation,
        fromRoom: from,
        toRoom: target,
      }, this.key("world-swap"));
    }
    if (this.state === "swapping" && toMs >= this.startedAtMs + ROOM_TRANSITION_TIMING.roomReadyAtMs) {
      const due = this.startedAtMs + ROOM_TRANSITION_TIMING.roomReadyAtMs;
      this.state = "stabilizing";
      this.trace.emit("room.transition.room_ready", due, {
        generation: this.generation,
        room: target,
      }, this.key("room-ready"));
    }
    if (this.state === "stabilizing" && toMs >= this.startedAtMs + ROOM_TRANSITION_TIMING.completeAtMs) {
      const due = this.startedAtMs + ROOM_TRANSITION_TIMING.completeAtMs;
      this.trace.emit("room.transition.complete", due, {
        generation: this.generation,
        room: target,
      }, this.key("complete"));
      this.state = "idle";
      this.targetRoom = undefined;
    }
  }

  private key(suffix: string): string {
    return `room-transition:${this.generation}:${suffix}`;
  }
}
