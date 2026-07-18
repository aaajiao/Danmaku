import {mulberry32} from "./pattern-compiler";
import type {Difficulty, PatternDefinition} from "./types";

export type RoomId = "INFORMATION" | "FORCED_ALIGNMENT" | "IN_BETWEEN" | "POLARIZED";

export type RunSegmentKind =
  | "AWAKENING"
  | "FIRST_EYE"
  | "ROOM_TRANSITION"
  | "ENCOUNTER"
  | "REST"
  | "OVERRIDE_GATE"
  | "BOSS_PHASE"
  | "DUSK"
  | "SNAPSHOT"
  | "CROSS_RUN";

export interface ComposerPatternEntry {
  patternId: string;
  baseWeight: number;
  cooldownEncounters: number;
}

export interface RoomComposerDefinition {
  id: string;
  room: RoomId;
  patternPool: ComposerPatternEntry[];
  intensityTiers: Array<{
    id: string;
    difficulty: Difficulty;
    budget: {maxProjectiles: number; maxEmitters: number; restMs: number};
  }>;
}

export interface RoomComposerManifest {
  composers: RoomComposerDefinition[];
}

export interface BossRigDefinition {
  id: string;
  room: RoomId;
  phases: Array<{id: string; patternId: string}>;
  resolution: {resolutionId: string; terminalEvent: string; materialRemainder: string};
}

export interface BossRigManifest {
  rigs: BossRigDefinition[];
}

export interface BehaviorLedger {
  flower: number;
  gaze: number;
  crack: number;
  override: number;
  contextSwitch: number;
  roomTimeMs: Record<RoomId, number>;
}

export interface RunSegment {
  id: string;
  kind: RunSegmentKind;
  label: {zh: string; en: string};
  durationMs: number;
  room: RoomId | "AWAKENING" | "CROSS_RUN";
  patternId: string | null;
  combat: boolean;
  difficulty: Difficulty;
  bossId: string | null;
  condition?: "EVIDENCE_AT_LEAST_OVERRIDE_COST";
}

export interface RunDirectorSnapshot {
  runId: string;
  seed: number;
  segmentIndex: number;
  segmentElapsedMs: number;
  runElapsedMs: number;
  segment: RunSegment;
  complete: boolean;
  meaningfulInputCount: number;
  visitedRooms: readonly RoomId[];
  bossCount: number;
}

export interface RunDirectorEvent {
  type: "segment.enter" | "segment.exit" | "run.complete" | "segment.skip";
  atMs: number;
  segment: RunSegment;
  detail: string;
}

export interface RunDirectorOptions {
  seed: number;
  patterns: readonly PatternDefinition[];
  composers: RoomComposerManifest;
  bosses: BossRigManifest;
  ledger?: Partial<Omit<BehaviorLedger, "roomTimeMs">> & {roomTimeMs?: Partial<Record<RoomId, number>>};
  overrideCost?: number;
  targetDurationMs?: number;
  onEvent?: (event: RunDirectorEvent) => void;
}

const ROOMS: readonly RoomId[] = ["INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"];

const EMPTY_ROOM_TIME: Record<RoomId, number> = {
  INFORMATION: 0,
  FORCED_ALIGNMENT: 0,
  IN_BETWEEN: 0,
  POLARIZED: 0,
};

function weightedPick<T>(items: readonly T[], weights: readonly number[], random: () => number): T {
  if (items.length === 0 || items.length !== weights.length) throw new Error("weightedPick requires aligned items and weights");
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return items[Math.floor(random() * items.length)] as T;
  let cursor = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= Math.max(0, weights[index] ?? 0);
    if (cursor <= 0) return items[index] as T;
  }
  return items[items.length - 1] as T;
}

function averageDuration(patterns: readonly PatternDefinition[]): number {
  if (patterns.length === 0) return 9000;
  return patterns.reduce((sum, pattern) => sum + pattern.durationMs, 0) / patterns.length;
}

/**
 * Compiles the V4 run contract into a deterministic, inspectable schedule.
 * The schedule samples behavior; it never assigns score, rank, or a moral end.
 */
export class RunDirector {
  readonly schedule: readonly RunSegment[];
  readonly seed: number;
  readonly runId: string;
  readonly ledger: BehaviorLedger;

  private segmentIndex = 0;
  private segmentElapsedMs = 0;
  private runElapsedMs = 0;
  private meaningfulInputCount = 0;
  private complete = false;
  private readonly overrideCost: number;
  private readonly onEvent: (event: RunDirectorEvent) => void;

  constructor(options: RunDirectorOptions) {
    if (!Number.isInteger(options.seed) || options.seed < 0) throw new Error("run seed must be a non-negative integer");
    this.seed = options.seed >>> 0;
    this.runId = `run-v4-${this.seed.toString(16).padStart(8, "0")}`;
    this.overrideCost = options.overrideCost ?? 3;
    this.onEvent = options.onEvent ?? (() => undefined);
    this.ledger = {
      flower: options.ledger?.flower ?? 0.5,
      gaze: options.ledger?.gaze ?? 0,
      crack: options.ledger?.crack ?? 0,
      override: options.ledger?.override ?? 0,
      contextSwitch: options.ledger?.contextSwitch ?? 0,
      roomTimeMs: {...EMPTY_ROOM_TIME, ...options.ledger?.roomTimeMs},
    };
    this.schedule = this.compileSchedule(options);
    const initial = this.schedule[0];
    if (!initial) throw new Error("run schedule is empty");
    this.emit("segment.enter", initial, `${initial.kind} · ${initial.id}`);
  }

  snapshot(): RunDirectorSnapshot {
    const segment = this.schedule[this.segmentIndex] ?? this.schedule[this.schedule.length - 1];
    if (!segment) throw new Error("run schedule is empty");
    return {
      runId: this.runId,
      seed: this.seed,
      segmentIndex: this.segmentIndex,
      segmentElapsedMs: this.segmentElapsedMs,
      runElapsedMs: this.runElapsedMs,
      segment,
      complete: this.complete,
      meaningfulInputCount: this.meaningfulInputCount,
      visitedRooms: this.visitedRooms(),
      bossCount: new Set(this.schedule.map((entry) => entry.bossId).filter(Boolean)).size,
    };
  }

  step(
    dtMs: number,
    facts: {evidence: number; meaningfulInput: boolean},
  ): RunDirectorSnapshot {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new Error("director dt must be finite and non-negative");
    if (this.complete || dtMs === 0) return this.snapshot();
    if (facts.meaningfulInput) this.meaningfulInputCount += 1;

    let remaining = dtMs;
    while (remaining > 0 && !this.complete) {
      const segment = this.currentSegment();
      if (segment.condition === "EVIDENCE_AT_LEAST_OVERRIDE_COST" && facts.evidence < this.overrideCost) {
        this.emit("segment.skip", segment, `condition unmet · evidence ${facts.evidence}/${this.overrideCost}`);
        this.advanceSegment();
        continue;
      }

      const awakeningHeld = segment.kind === "AWAKENING" && this.meaningfulInputCount < 2;
      const untilBoundary = Math.max(0, segment.durationMs - this.segmentElapsedMs);
      const consumed = awakeningHeld && untilBoundary === 0 ? remaining : Math.min(remaining, untilBoundary);
      this.segmentElapsedMs += consumed;
      this.runElapsedMs += consumed;
      remaining -= consumed;
      if (ROOMS.includes(segment.room as RoomId)) {
        this.ledger.roomTimeMs[segment.room as RoomId] += consumed;
      }

      if (this.segmentElapsedMs >= segment.durationMs && !awakeningHeld) {
        this.advanceSegment();
      } else if (consumed === 0) {
        break;
      }
    }
    return this.snapshot();
  }

  private compileSchedule(options: RunDirectorOptions): RunSegment[] {
    const patternById = new Map(options.patterns.map((pattern) => [pattern.id, pattern]));
    const composerByRoom = new Map(options.composers.composers.map((composer) => [composer.room, composer]));
    const random = mulberry32(this.seed);
    const segments: RunSegment[] = [];
    let serial = 0;
    const push = (segment: Omit<RunSegment, "id">): void => {
      segments.push({...segment, id: `${String(serial++).padStart(3, "0")}.${segment.kind.toLowerCase()}`});
    };
    const patternSegment = (
      kind: RunSegmentKind,
      patternId: string,
      room: RunSegment["room"],
      difficulty: Difficulty,
      bossId: string | null = null,
    ): void => {
      const pattern = patternById.get(patternId);
      if (!pattern) throw new Error(`run director references unknown pattern: ${patternId}`);
      push({
        kind,
        label: pattern.name,
        durationMs: pattern.durationMs,
        room,
        patternId,
        combat: true,
        difficulty,
        bossId,
      });
    };

    push({
      kind: "AWAKENING",
      label: {zh: "安静觉醒", en: "Quiet awakening"},
      durationMs: 8000,
      room: "AWAKENING",
      patternId: null,
      combat: false,
      difficulty: "EASY",
      bossId: null,
    });
    patternSegment("FIRST_EYE", "common.eye_acquisition", "INFORMATION", "EASY");

    const roomCount = 2 + Math.floor(random() * 3);
    const selectedRooms = this.selectRooms(roomCount, random);
    const targetDuration = Math.max(240000, options.targetDurationMs ?? (300000 + Math.floor(random() * 120001)));
    const bossLimit = Math.min(2, selectedRooms.length);
    const selectedBosses = this.selectBosses(selectedRooms, options.bosses.rigs, bossLimit, random);
    const meanPatternDuration = averageDuration(options.patterns.filter((pattern) => pattern.category === "ROOM"));
    const projectedFixed = 8000 + (patternById.get("common.eye_acquisition")?.durationMs ?? 8000)
      + selectedBosses.reduce((sum, boss) => sum + boss.phases.reduce((phaseSum, phase) => {
        return phaseSum + (patternById.get(phase.patternId)?.durationMs ?? 10000) + 1000;
      }, 0), 0)
      + (patternById.get("transition.dusk_settle")?.durationMs ?? 8000) + 5000;
    const encountersNeeded = Math.max(
      selectedRooms.length * 2,
      Math.ceil((targetDuration - projectedFixed) / Math.max(1, meanPatternDuration + 1100)),
    );
    const encountersPerRoom = Math.max(2, Math.ceil(encountersNeeded / selectedRooms.length));

    selectedRooms.forEach((room, roomIndex) => {
      patternSegment("ROOM_TRANSITION", "transition.room_threshold", room, "EASY");
      const composer = composerByRoom.get(room);
      if (!composer) throw new Error(`missing room composer: ${room}`);
      const recent: string[] = [];
      for (let encounter = 0; encounter < encountersPerRoom; encounter += 1) {
        const entry = this.selectComposerPattern(composer, recent, random);
        const tier = composer.intensityTiers[Math.min(
          composer.intensityTiers.length - 1,
          Math.floor(encounter / Math.max(1, encountersPerRoom / composer.intensityTiers.length)),
        )] ?? composer.intensityTiers[0];
        const difficulty = tier?.difficulty ?? "NORMAL";
        patternSegment("ENCOUNTER", entry.patternId, room, difficulty);
        recent.push(entry.patternId);
        while (recent.length > 3) recent.shift();
        push({
          kind: "REST",
          label: {zh: "材料沉降", en: "Material settle"},
          durationMs: tier?.budget.restMs ?? 1100,
          room,
          patternId: null,
          combat: false,
          difficulty,
          bossId: null,
        });
      }

      const boss = selectedBosses.find((candidate) => candidate.room === room);
      if (boss) {
        for (const phase of boss.phases) {
          patternSegment("BOSS_PHASE", phase.patternId, room, "NORMAL", boss.id);
          push({
            kind: "REST",
            label: {zh: "协议换相", en: "Protocol phase handoff"},
            durationMs: 1000,
            room,
            patternId: null,
            combat: false,
            difficulty: "NORMAL",
            bossId: boss.id,
          });
        }
      }

      if (roomIndex === 0) {
        const overridePattern = patternById.get("transition.override_void");
        if (overridePattern) {
          push({
            kind: "OVERRIDE_GATE",
            label: overridePattern.name,
            durationMs: overridePattern.durationMs,
            room,
            patternId: overridePattern.id,
            combat: true,
            difficulty: "NORMAL",
            bossId: null,
            condition: "EVIDENCE_AT_LEAST_OVERRIDE_COST",
          });
        }
      }
    });

    patternSegment("DUSK", "transition.dusk_settle", selectedRooms[selectedRooms.length - 1] ?? "POLARIZED", "EASY");
    push({
      kind: "SNAPSHOT",
      label: {zh: "状态快照", en: "State snapshot"},
      durationMs: 1630,
      room: selectedRooms[selectedRooms.length - 1] ?? "POLARIZED",
      patternId: null,
      combat: false,
      difficulty: "EASY",
      bossId: null,
    });
    push({
      kind: "CROSS_RUN",
      label: {zh: "材料交接", en: "Cross-run material handoff"},
      durationMs: 1140,
      room: "CROSS_RUN",
      patternId: null,
      combat: false,
      difficulty: "EASY",
      bossId: null,
    });
    return segments;
  }

  private selectRooms(count: number, random: () => number): RoomId[] {
    const available = [...ROOMS];
    const selected: RoomId[] = [];
    while (available.length > 0 && selected.length < count) {
      const weights = available.map((room) => {
        switch (room) {
          case "INFORMATION": return 1 + this.ledger.flower * 0.3 + this.ledger.gaze * 0.18;
          case "FORCED_ALIGNMENT": return 1 + this.ledger.crack * 0.34 + this.ledger.flower * 0.12;
          case "IN_BETWEEN": return 1 + this.ledger.contextSwitch * 0.28 + this.ledger.gaze * 0.22;
          case "POLARIZED": return 1 + this.ledger.override * 0.3 + this.ledger.flower * 0.24;
        }
      });
      const room = weightedPick(available, weights, random);
      selected.push(room);
      available.splice(available.indexOf(room), 1);
    }
    return selected;
  }

  private selectBosses(
    rooms: readonly RoomId[],
    bosses: readonly BossRigDefinition[],
    limit: number,
    random: () => number,
  ): BossRigDefinition[] {
    const selected: BossRigDefinition[] = [];
    for (const room of rooms) {
      if (selected.length >= limit) break;
      const pool = bosses.filter((boss) => boss.room === room && !selected.includes(boss));
      if (pool.length === 0) continue;
      const boss = pool[Math.floor(random() * pool.length)];
      if (boss) selected.push(boss);
    }
    return selected;
  }

  private selectComposerPattern(
    composer: RoomComposerDefinition,
    recent: readonly string[],
    random: () => number,
  ): ComposerPatternEntry {
    const eligible = composer.patternPool.filter((entry) => !recent.slice(-entry.cooldownEncounters).includes(entry.patternId));
    const pool = eligible.length > 0 ? eligible : composer.patternPool;
    return weightedPick(pool, pool.map((entry) => entry.baseWeight), random);
  }

  private currentSegment(): RunSegment {
    const segment = this.schedule[this.segmentIndex];
    if (!segment) throw new Error("run director is beyond its schedule");
    return segment;
  }

  private advanceSegment(): void {
    const previous = this.currentSegment();
    this.emit("segment.exit", previous, `${previous.kind} complete`);
    this.segmentElapsedMs = 0;
    if (this.segmentIndex >= this.schedule.length - 1) {
      this.complete = true;
      this.emit("run.complete", previous, "run cycle complete");
      return;
    }
    this.segmentIndex += 1;
    const next = this.currentSegment();
    this.emit("segment.enter", next, `${next.kind} · ${next.id}`);
  }

  private visitedRooms(): RoomId[] {
    const visited: RoomId[] = [];
    for (let index = 0; index <= this.segmentIndex; index += 1) {
      const room = this.schedule[index]?.room;
      if (room && ROOMS.includes(room as RoomId) && !visited.includes(room as RoomId)) visited.push(room as RoomId);
    }
    return visited;
  }

  private emit(type: RunDirectorEvent["type"], segment: RunSegment, detail: string): void {
    this.onEvent({type, segment, detail, atMs: this.runElapsedMs});
  }
}
