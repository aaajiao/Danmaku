import type {RoomId} from "../../../1bit-stg-complete-asset-kit-v4/runtime/world";
import {
  isExactCanonicalEventBus,
  type CanonicalEventBus,
  type CanonicalGameplayEvent,
} from "./events";
import {
  GHOST_SAMPLE_INTERVAL_MS,
  RunMemoryRecorder,
  type BehaviorFactKind,
  type BurnIn,
  type DeathTrace,
  type Direction8,
  type FinalizedRunMemory,
  type GhostFlag,
  type GhostResidue,
  type OverrideScar,
  type RunMemory,
  type WeatherId,
  type WitnessMemory,
} from "./run-memory-model";
import {crossedTickCount, TICKS_PER_SECOND} from "./tick120";

/**
 * Run metrics glue: turns the live canonical event trace plus a small set of
 * explicit conductor observations into one schema-complete V4 RunMemory
 * record. All accumulation is deferred to the S1 RunMemoryRecorder wherever it
 * already owns an input surface (behavior facts, ghost route, material
 * memory); this module only maps canonical events onto those surfaces and adds
 * thin integer accumulators (tick dwell totals, the ghost due-tick schedule)
 * for what the recorder cannot observe on its own.
 *
 * Frozen v1 decisions, recorded here on purpose:
 * - The collector is read-only over the bus: it drains committed events with a
 *   consumed cursor (`committedEventCount`/`committedEventsFrom`) and never
 *   enqueues, flushes, or mutates gameplay state.
 * - Ghost sampling follows the tick120 integer grid: gameplay-time sample n is
 *   due at the first integer tick at or after n*120ms, i.e.
 *   `crossedTickCount(n * 120)` (round-up, never floats). The recorded tMs is
 *   the nominal 120ms grid value `n * 120` per ghost-replay-contract-v4.
 * - Event pins use tMs = round(gameplayTicks * 1000 / 120); a pin landing on
 *   an already-captured tMs merges its flag into that point.
 * - Material-memory entries (scars, death traces, burn-ins, residues) and
 *   witness facts require normalized room coordinates the event payloads do
 *   not carry, so they arrive through explicit observe hooks the conductor
 *   calls with authority-owned normalized data; the collector never fabricates
 *   positions from pixel-space payloads.
 */

const ROOM_IDS = ["INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"] as const;
const WEATHER_IDS = ["STATIC", "RAIN", "ASH", "WIND", "ECLIPSE"] as const;

/** Octants for atan2 in screen space (x right, y down): 0 rad = E, +PI/2 = S. */
const OCTANTS: readonly Direction8[] = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];

function isRoomId(value: unknown): value is RoomId {
  return typeof value === "string" && (ROOM_IDS as readonly string[]).includes(value);
}

function requireRoomId(value: unknown, path: string): RoomId {
  if (!isRoomId(value)) throw new Error(`${path} is not a canonical V4 room id: ${String(value)}`);
  return value;
}

function requireWeatherId(value: unknown, path: string): WeatherId {
  if (typeof value !== "string" || !(WEATHER_IDS as readonly string[]).includes(value)) {
    throw new Error(`${path} is not a canonical V4 weather class: ${String(value)}`);
  }
  return value as WeatherId;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requirePositiveInteger(value: unknown, path: string): number {
  const integer = requireNonNegativeInteger(value, path);
  if (integer === 0) throw new Error(`${path} must be a positive integer`);
  return integer;
}

function requireRatio(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a ratio in [0, 1]`);
  }
  return value;
}

function requireFiniteNonNegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be finite and non-negative`);
  }
  return value;
}

/** Nominal milliseconds for an integer count of gameplay ticks (rounded). */
function msForGameplayTicks(gameplayTicks: number): number {
  return Math.round(gameplayTicks * 1000 / TICKS_PER_SECOND);
}

/**
 * The authoritative ghost sampling schedule: sample `sampleIndex` is due at
 * the first integer tick at or after `sampleIndex * 120` gameplay
 * milliseconds. At 120Hz that is ceil(sampleIndex * 14.4) ticks, so the
 * schedule starts 0, 15, 29, 44, 58, 72, 87, 101, 116, 130, 144, ...
 */
export function ghostSampleDueTick(sampleIndex: number): number {
  requireNonNegativeInteger(sampleIndex, "ghost sample index");
  return crossedTickCount(sampleIndex * GHOST_SAMPLE_INTERVAL_MS);
}

/** Map an authority direction vector to the nearest of the 8 scar octants. */
export function direction8FromVector(directionX: number, directionY: number): Direction8 {
  if (!Number.isFinite(directionX) || !Number.isFinite(directionY) || (directionX === 0 && directionY === 0)) {
    throw new Error("direction vector must be finite and non-zero");
  }
  const angle = Math.atan2(directionY, directionX);
  const octant = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return OCTANTS[octant] as Direction8;
}

interface MutableGhostSample {
  readonly tMs: number;
  xNorm: number;
  yNorm: number;
  room: RoomId;
  flower: number;
  focus: boolean;
  readonly flags: Set<GhostFlag>;
}

interface PlayerTransform {
  readonly xNorm: number;
  readonly yNorm: number;
  readonly flower: number;
  readonly focus: boolean;
}

export interface RunMetricsCollectorOptions {
  readonly runId: string;
  readonly seed: number;
  readonly startedAtTick: number;
  readonly initialRoom: RoomId;
  readonly bus: CanonicalEventBus;
}

export interface RunMetricsFinalizeOptions {
  readonly endedAtTick: number;
  readonly resolution: RunMemory["resolution"];
  readonly observationIds?: readonly string[];
  readonly behaviorTags?: readonly string[];
}

export class RunMetricsCollector {
  readonly runId: string;
  readonly startedAtTick: number;

  private readonly bus: CanonicalEventBus;
  private readonly recorder: RunMemoryRecorder;

  /** Consumed cursor into the bus's committed trace; read-only observation. */
  private cursor: number;

  private currentRoom: RoomId;
  private segmentOrdinal = 0;
  private readonly visitedRooms: RoomId[];
  private lastKnownTick: number;
  private finalized = false;

  private observationCounter = 0;
  private meaningfulInputEdges = 0;

  private readonly roomDwellTicks: Record<RoomId, number> = {
    INFORMATION: 0,
    FORCED_ALIGNMENT: 0,
    IN_BETWEEN: 0,
    POLARIZED: 0,
  };
  private focusDwellTicks = 0;
  private seamDwellTicks = 0;
  private stableIntersectionDwellTicks = 0;

  private gazeClampOpen: {readonly sinceMs: number} | null = null;
  private weatherExposureOpen: {readonly weather: WeatherId; readonly sinceMs: number} | null = null;
  private lastFlowerBand: 0 | 1 | 2 | null = null;

  private readonly ghostSamples = new Map<number, MutableGhostSample>();
  private nextSampleIndex = 0;
  private lastTransform: PlayerTransform | null = null;
  private lastTransformTick: number;
  private readonly pendingInitialFlags = new Set<GhostFlag>();

  constructor(options: RunMetricsCollectorOptions) {
    if (!isExactCanonicalEventBus(options.bus)) {
      throw new Error("run metrics collector requires an exact CanonicalEventBus");
    }
    this.bus = options.bus;
    this.currentRoom = requireRoomId(options.initialRoom, "initial room");
    this.recorder = new RunMemoryRecorder({
      runId: options.runId,
      seed: options.seed,
      startedAtTick: options.startedAtTick,
      tickHz: TICKS_PER_SECOND,
    });
    this.runId = options.runId;
    this.startedAtTick = options.startedAtTick;
    this.lastKnownTick = options.startedAtTick;
    this.lastTransformTick = options.startedAtTick;
    this.visitedRooms = [this.currentRoom];
    // Only events committed after construction belong to this run's record.
    this.cursor = this.bus.committedEventCount();
    // The run factually begins in its initial room; record that entry once
    // here so room-transition events only ever describe subsequent entries.
    this.recordFact("ROOM_ENTER", this.startedAtTick, "run-begin-room-enter", {room: this.currentRoom});
    this.pendingInitialFlags.add("ROOM_ENTER");
  }

  /**
   * Drain newly committed canonical events (consumed-cursor pattern) and map
   * them onto behavior facts and ghost pins. Never mutates the bus. Returns
   * the number of events observed by this call.
   */
  drainCanonicalEvents(): number {
    this.assertLive();
    const total = this.bus.committedEventCount();
    if (total === this.cursor) return 0;
    const batch = this.bus.committedEventsFrom(this.cursor);
    for (const event of batch) this.ingest(event);
    this.cursor += batch.length;
    return batch.length;
  }

  /**
   * Observe the authoritative player transform for one gameplay tick and run
   * the 120ms-grid ghost sampling schedule (integer due ticks via
   * crossedTickCount round-up).
   */
  observePlayerTransform(tick120: number, xNorm: number, yNorm: number, flower: number, focus: boolean): void {
    this.assertLive();
    const tick = requireNonNegativeInteger(tick120, "transform tick120");
    if (tick < this.startedAtTick) throw new Error("transform tick precedes the run start");
    if (tick < this.lastTransformTick) throw new Error("transform ticks must be non-decreasing");
    if (typeof focus !== "boolean") throw new Error("transform focus must be a boolean");
    this.lastTransform = {
      xNorm: requireRatio(xNorm, "transform xNorm"),
      yNorm: requireRatio(yNorm, "transform yNorm"),
      flower: requireRatio(flower, "transform flower"),
      focus,
    };
    this.lastTransformTick = tick;
    this.lastKnownTick = Math.max(this.lastKnownTick, tick);
    const gameplayTicks = tick - this.startedAtTick;
    while (gameplayTicks >= ghostSampleDueTick(this.nextSampleIndex)) {
      this.captureGhostSample(this.nextSampleIndex * GHOST_SAMPLE_INTERVAL_MS);
      this.nextSampleIndex += 1;
    }
  }

  /** Attribute one integer span of gameplay ticks to a room's dwell total. */
  observeRoomTime(roomId: RoomId, tick120Delta: number): void {
    this.assertLive();
    const room = requireRoomId(roomId, "room time roomId");
    this.roomDwellTicks[room] += requirePositiveInteger(tick120Delta, "room time tick delta");
  }

  /** Count one meaningful-input rising edge (conductor guard fact, not a metric). */
  observeMeaningfulInputEdge(): void {
    this.assertLive();
    this.meaningfulInputEdges += 1;
  }

  meaningfulInputEdgeCount(): number {
    return this.meaningfulInputEdges;
  }

  observeFocusEntry(): void {
    this.assertLive();
    this.recordFact("FOCUS_ENTER", this.lastKnownTick, this.nextObservationId());
  }

  observeFocusDwell(tick120Delta: number): void {
    this.assertLive();
    this.focusDwellTicks += requirePositiveInteger(tick120Delta, "focus dwell tick delta");
  }

  observeFocusReleaseBeforeImpact(): void {
    this.assertLive();
    this.recordFact("FOCUS_RELEASE_BEFORE_IMPACT", this.lastKnownTick, this.nextObservationId());
  }

  observeSeamDwell(tick120Delta: number): void {
    this.assertLive();
    this.seamDwellTicks += requirePositiveInteger(tick120Delta, "seam dwell tick delta");
  }

  observeStableIntersectionDwell(tick120Delta: number): void {
    this.assertLive();
    this.stableIntersectionDwellTicks += requirePositiveInteger(tick120Delta, "stable intersection tick delta");
  }

  observeGazeStill(stillMs: number): void {
    this.assertLive();
    this.recordFact("GAZE_STILL", this.lastKnownTick, this.nextObservationId(), {
      amount: requireNonNegativeInteger(stillMs, "gaze still ms"),
    });
  }

  observeIncompleteRead(): void {
    this.assertLive();
    this.recordFact("INCOMPLETE_READ", this.lastKnownTick, this.nextObservationId());
  }

  observeReadPredictionMismatchStreak(streakLength: number): void {
    this.assertLive();
    this.recordFact("READ_MISMATCH_STREAK", this.lastKnownTick, this.nextObservationId(), {
      amount: requireNonNegativeInteger(streakLength, "read mismatch streak length"),
    });
  }

  observeCableUpload(): void {
    this.assertLive();
    this.recordFact("CABLE_UPLOAD", this.lastKnownTick, this.nextObservationId());
  }

  observeRoomThresholdCrossing(): void {
    this.assertLive();
    this.recordFact("ROOM_THRESHOLD_CROSS", this.lastKnownTick, this.nextObservationId());
  }

  observeOverrideScarRuleIntersection(): void {
    this.assertLive();
    this.recordFact("OVERRIDE_SCAR_RULE_INTERSECTION", this.lastKnownTick, this.nextObservationId());
  }

  observeWitnessResistanceTransmission(): void {
    this.assertLive();
    this.recordFact("WITNESS_RESISTANCE_TRANSMISSION", this.lastKnownTick, this.nextObservationId());
  }

  /** Material-memory and witness pass-through: conductor supplies normalized data. */
  observeOverrideScar(entry: OverrideScar): void {
    this.assertLive();
    this.recorder.addOverrideScar(entry);
  }

  observeDeathTrace(entry: DeathTrace): void {
    this.assertLive();
    this.recorder.addDeathTrace(entry);
  }

  observeBurnIn(entry: BurnIn): void {
    this.assertLive();
    this.recorder.addBurnIn(entry);
  }

  observeGhostResidue(entry: GhostResidue): void {
    this.assertLive();
    this.recorder.addGhostResidue(entry);
  }

  observeWitness(entry: WitnessMemory): void {
    this.assertLive();
    this.recorder.recordWitness(entry);
  }

  /**
   * Close all open accumulations, feed the buffered ghost route to the
   * recorder, and produce the finalized schema-complete record.
   */
  finalize(options: RunMetricsFinalizeOptions): FinalizedRunMemory {
    this.assertLive();
    const endedAtTick = requireNonNegativeInteger(options.endedAtTick, "endedAtTick");
    if (endedAtTick < this.lastKnownTick) {
      throw new Error("run cannot end before its last observed tick");
    }
    this.finalized = true;
    const endMs = endedAtTick * 1000 / TICKS_PER_SECOND;

    if (this.gazeClampOpen !== null) {
      this.recordFact("GAZE_DWELL", endedAtTick, "finalize-open-gaze-dwell", {
        amount: Math.max(0, Math.round(endMs - this.gazeClampOpen.sinceMs)),
      });
      this.gazeClampOpen = null;
    }
    if (this.weatherExposureOpen !== null) {
      this.recordFact("WEATHER_EXPOSURE", endedAtTick, "finalize-open-weather-exposure", {
        amount: Math.max(0, Math.round(endMs - this.weatherExposureOpen.sinceMs)),
        weather: this.weatherExposureOpen.weather,
      });
      this.weatherExposureOpen = null;
    }
    for (const room of ROOM_IDS) {
      const ticks = this.roomDwellTicks[room];
      if (ticks > 0) {
        this.recordFact("ROOM_DWELL", endedAtTick, `finalize-room-dwell-${room}`, {
          room,
          amount: msForGameplayTicks(ticks),
        });
      }
    }
    if (this.focusDwellTicks > 0) {
      this.recordFact("FOCUS_DWELL", endedAtTick, "finalize-focus-dwell", {
        amount: msForGameplayTicks(this.focusDwellTicks),
      });
    }
    if (this.seamDwellTicks > 0) {
      this.recordFact("SEAM_DWELL", endedAtTick, "finalize-seam-dwell", {
        amount: msForGameplayTicks(this.seamDwellTicks),
      });
    }
    if (this.stableIntersectionDwellTicks > 0) {
      this.recordFact("STABLE_INTERSECTION_DWELL", endedAtTick, "finalize-stable-intersection-dwell", {
        amount: msForGameplayTicks(this.stableIntersectionDwellTicks),
      });
    }

    for (const tMs of [...this.ghostSamples.keys()].sort((left, right) => left - right)) {
      const sample = this.ghostSamples.get(tMs) as MutableGhostSample;
      this.recorder.recordGhostPoint({
        tMs: sample.tMs,
        xNorm: sample.xNorm,
        yNorm: sample.yNorm,
        room: sample.room,
        flower: sample.flower,
        focus: sample.focus,
        flags: [...sample.flags],
      });
    }

    return this.recorder.finalize({
      endedAtTick,
      resolution: options.resolution,
      roomsVisited: [...this.visitedRooms],
      ...(options.observationIds !== undefined ? {observationIds: options.observationIds} : {}),
      ...(options.behaviorTags !== undefined ? {behaviorTags: options.behaviorTags} : {}),
    });
  }

  private assertLive(): void {
    if (this.finalized) throw new Error("run metrics collector is already finalized");
  }

  private nextObservationId(): string {
    this.observationCounter += 1;
    return `obs-${String(this.observationCounter).padStart(8, "0")}`;
  }

  private recordFact(
    kind: BehaviorFactKind,
    atTick: number,
    eventId: string,
    extras: {
      readonly room?: RoomId;
      readonly amount?: number;
      readonly sourceId?: string;
      readonly direction8?: Direction8;
      readonly weather?: WeatherId;
    } = {},
  ): void {
    const room = extras.room ?? this.currentRoom;
    this.recorder.recordBehaviorFact({
      segmentId: `seg-${String(this.segmentOrdinal).padStart(4, "0")}-${room}`,
      room,
      atTick,
      eventId,
      kind,
      ...(extras.amount !== undefined ? {amount: extras.amount} : {}),
      ...(extras.sourceId !== undefined ? {sourceId: extras.sourceId} : {}),
      ...(extras.direction8 !== undefined ? {direction8: extras.direction8} : {}),
      ...(extras.weather !== undefined ? {weather: extras.weather} : {}),
    });
  }

  private ingest(event: CanonicalGameplayEvent): void {
    if (event.tick120 < this.startedAtTick) {
      throw new Error("canonical event precedes the run start tick");
    }
    this.lastKnownTick = Math.max(this.lastKnownTick, event.tick120);
    const id = event.id as string;
    switch (id) {
      case "projectile.graze.commit": {
        const projectileId = String(event.payload["projectileId"]);
        const generation = String(event.payload["projectileGeneration"]);
        this.recordFact("GRAZE_EVIDENCE", event.tick120, event.occurrenceKey, {
          amount: 1,
          sourceId: `${projectileId}:${generation}`,
        });
        this.pinGhost("GRAZE", event.tick120);
        break;
      }
      case "evidence.consume.commit": {
        this.recordFact("GRAZE_EVIDENCE_SPENT", event.tick120, event.occurrenceKey, {
          amount: requireFiniteNonNegative(event.payload["amount"], "evidence.consume.commit amount"),
        });
        break;
      }
      case "flower.intensity.commit": {
        const intensity = requireRatio(
          event.payload["targetIntensity"],
          "flower.intensity.commit targetIntensity",
        );
        this.recordFact("LIGHT_SAMPLE", event.tick120, event.occurrenceKey, {amount: intensity});
        const band: 0 | 1 | 2 = intensity < 1 / 3 ? 0 : intensity <= 2 / 3 ? 1 : 2;
        if (this.lastFlowerBand !== null && band !== this.lastFlowerBand) {
          this.recordFact("LIGHT_BAND_CHANGE", event.tick120, `${event.occurrenceKey}#band`, {amount: 1});
        }
        this.lastFlowerBand = band;
        break;
      }
      case "gaze.acquire.begin": {
        this.recordFact("GAZE_ACQUIRE", event.tick120, event.occurrenceKey, {amount: 1});
        break;
      }
      case "gaze.clamp.commit": {
        this.recordFact("GAZE_CLAMP", event.tick120, event.occurrenceKey, {amount: 1});
        this.gazeClampOpen = {sinceMs: event.simulationTimeMs};
        this.pinGhost("GAZE", event.tick120);
        break;
      }
      case "gaze.clamp.release": {
        if (this.gazeClampOpen !== null) {
          this.recordFact("GAZE_DWELL", event.tick120, event.occurrenceKey, {
            amount: Math.max(0, Math.round(event.simulationTimeMs - this.gazeClampOpen.sinceMs)),
          });
          this.gazeClampOpen = null;
        }
        break;
      }
      case "player.override.local_void.open": {
        // player.override.commit carries no direction; the same-tick void-open
        // event is the single canonical carrier of the committed direction, so
        // the Override count is accumulated here exactly once per cycle.
        const direction8 = direction8FromVector(
          requireFiniteNumberPayload(event.payload["directionX"], "local_void.open directionX"),
          requireFiniteNumberPayload(event.payload["directionY"], "local_void.open directionY"),
        );
        this.recordFact("OVERRIDE_COMMIT", event.tick120, event.occurrenceKey, {amount: 1, direction8});
        if (this.gazeClampOpen !== null) {
          this.recordFact("OVERRIDE_DURING_GAZE", event.tick120, `${event.occurrenceKey}#during-gaze`, {amount: 1});
        }
        this.pinGhost("OVERRIDE", event.tick120);
        break;
      }
      case "player.damage.commit": {
        this.recordFact("DAMAGE_COMMIT", event.tick120, event.occurrenceKey, {amount: 1});
        this.pinGhost("DAMAGE", event.tick120);
        break;
      }
      case "player.death.commit": {
        // A body collapse resets the run body; the fall-reset dimension is the
        // factual (non-evaluative) trace of that reset.
        this.recordFact("FALL_RESET", event.tick120, event.occurrenceKey, {amount: 1});
        this.pinGhost("DAMAGE", event.tick120);
        break;
      }
      case "room.transition.world_swap.commit": {
        const fromRoom = requireRoomId(event.payload["fromRoom"], "world_swap fromRoom");
        const toRoom = requireRoomId(event.payload["toRoom"], "world_swap toRoom");
        if (fromRoom !== this.currentRoom) {
          throw new Error(`world swap fromRoom ${fromRoom} diverges from observed room ${this.currentRoom}`);
        }
        this.recordFact("SEAM_CROSS", event.tick120, event.occurrenceKey, {amount: 1, room: fromRoom});
        this.pinGhost("SEAM_CROSS", event.tick120);
        this.currentRoom = toRoom;
        this.segmentOrdinal += 1;
        if (!this.visitedRooms.includes(toRoom)) this.visitedRooms.push(toRoom);
        break;
      }
      case "room.transition.room_ready": {
        const room = requireRoomId(event.payload["room"], "room_ready room");
        this.recordFact("ROOM_ENTER", event.tick120, event.occurrenceKey, {room});
        this.pinGhost("ROOM_ENTER", event.tick120);
        break;
      }
      case "weather.active.begin": {
        const weather = requireWeatherId(event.payload["weather"], "weather.active.begin weather");
        if (this.weatherExposureOpen !== null) {
          throw new Error("overlapping weather exposure is not a V4 fact");
        }
        this.weatherExposureOpen = {weather, sinceMs: event.simulationTimeMs};
        break;
      }
      case "weather.aftermath.begin":
      case "weather.complete": {
        const weather = requireWeatherId(event.payload["weather"], `${id} weather`);
        if (this.weatherExposureOpen !== null && this.weatherExposureOpen.weather === weather) {
          this.recordFact("WEATHER_EXPOSURE", event.tick120, event.occurrenceKey, {
            amount: Math.max(0, Math.round(event.simulationTimeMs - this.weatherExposureOpen.sinceMs)),
            weather,
          });
          this.weatherExposureOpen = null;
        }
        break;
      }
      case "witness.turn": {
        if (this.weatherExposureOpen?.weather === "ECLIPSE") {
          this.recordFact("WITNESS_TURN_DURING_ECLIPSE", event.tick120, event.occurrenceKey, {amount: 1});
        }
        break;
      }
      case "boss.encounter.resolve": {
        if (event.payload["outcome"] === "NO_DUSK_WITHDRAWAL") {
          this.recordFact("NO_DUSK_CYCLE", event.tick120, event.occurrenceKey, {amount: 1});
        }
        break;
      }
      case "snapshot.present.begin": {
        this.recordFact("SNAPSHOT_ECHO", event.tick120, event.occurrenceKey, {amount: 1});
        break;
      }
      default:
        // Every other canonical event is either presentation-facing or already
        // represented by an authority-owned observe hook; ignoring it here is
        // an honest zero, not a dropped metric path.
        break;
    }
  }

  private captureGhostSample(tMs: number): void {
    if (this.lastTransform === null) {
      throw new Error("ghost sampling requires an observed player transform");
    }
    const existing = this.ghostSamples.get(tMs);
    if (existing !== undefined) {
      existing.xNorm = this.lastTransform.xNorm;
      existing.yNorm = this.lastTransform.yNorm;
      existing.room = this.currentRoom;
      existing.flower = this.lastTransform.flower;
      existing.focus = this.lastTransform.focus;
      return;
    }
    this.createGhostSample(tMs, this.lastTransform);
  }

  private pinGhost(flag: GhostFlag, tick120: number): void {
    if (this.lastTransform === null) {
      // No authoritative transform yet: attach the flag to the first sample.
      this.pendingInitialFlags.add(flag);
      return;
    }
    const gameplayTicks = tick120 - this.startedAtTick;
    const tMs = msForGameplayTicks(gameplayTicks);
    const existing = this.ghostSamples.get(tMs);
    if (existing !== undefined) {
      existing.flags.add(flag);
      return;
    }
    const sample = this.createGhostSample(tMs, this.lastTransform);
    sample.flags.add(flag);
  }

  private createGhostSample(tMs: number, transform: PlayerTransform): MutableGhostSample {
    const flags = new Set<GhostFlag>();
    if (this.ghostSamples.size === 0) {
      for (const pending of this.pendingInitialFlags) flags.add(pending);
      this.pendingInitialFlags.clear();
    }
    const sample: MutableGhostSample = {
      tMs,
      xNorm: transform.xNorm,
      yNorm: transform.yNorm,
      room: this.currentRoom,
      flower: transform.flower,
      focus: transform.focus,
      flags,
    };
    this.ghostSamples.set(tMs, sample);
    return sample;
  }
}

function requireFiniteNumberPayload(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}
