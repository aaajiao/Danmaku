import weatherSystemJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/weather-system-v4.json";
import {
  CanonicalEventBus,
  isExactCanonicalEventBus,
  simulationTimeMsForTick,
  type GameplayEventDraft,
} from "./events";
import {crossedTickCount} from "./tick120";

/**
 * WeatherScheduler — deterministic world-presentation weather authority.
 *
 * Authority boundary (V4 weather-system invariants): weather cannot move
 * bullets, hitboxes, safe lanes or player collision. This module enforces that
 * boundary structurally, not by convention:
 *
 * - Its only write port is `weather.*` canonical events through the shared
 *   CanonicalEventBus. Every `weather.*` id maps to the stateOrDamageCommit
 *   phase in events.ts (`phasePriorityFor`), so the scheduler can never emit
 *   a collision-off / collision-on / spawn-commit phase fact.
 * - It owns a private Mulberry32 stream per weather cycle that no other
 *   module can observe or share; gameplay RNG streams are untouched.
 * - Its read port is a deep-frozen snapshot. behaviorBias values are surfaced
 *   as `WeatherPresentationBiasView` (clamped presentation-only numbers);
 *   there is no method that accepts or returns projectile, collision or
 *   gameplay-RNG state.
 */

const WEATHER_SCHEDULER_ENTITY_ID = "weather-scheduler";

/** Manifest-authored residue tokens; non-persistent class (room-local only). */
export const WEATHER_RESIDUE_TOKENS = Object.freeze([
  "characterPuddle",
  "binaryPuddle",
  "routeAsh",
  "misalignedShadowScuff",
  "eclipseInversion",
] as const);
export type WeatherResidueToken = typeof WEATHER_RESIDUE_TOKENS[number];

export type WeatherPhase = "idle" | "cooldown" | "omen" | "active" | "aftermath";

/**
 * Presentation-only behavior bias. These numbers may shade selection
 * probability by at most ±30% (manifest rule) and are surfaced read-only for
 * the presentation/conductor layers; they are never a gameplay write surface.
 */
export type WeatherPresentationBiasView = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

export interface WeatherResidueFact {
  readonly weather: string;
  readonly residue: WeatherResidueToken;
  readonly cycle: number;
  readonly tick120: number;
  /** Residue is a room-local presentation fact, never cross-run material. */
  readonly persistence: "room-local";
}

export interface WeatherSchedulerSnapshot {
  readonly authority: "weather-presentation";
  readonly tick120: number;
  readonly phase: WeatherPhase;
  readonly classId: string | null;
  readonly biasView: WeatherPresentationBiasView;
  readonly residues: readonly WeatherResidueFact[];
  /**
   * ECLIPSE burst exception fact: while an ECLIPSE burst is active, witnesses
   * may face the player instead of the Eye (final gating on flower intensity
   * belongs to presentation; this flag only states the window is open).
   */
  readonly witnessFacePlayerException: boolean;
}

interface WeatherClassDefinition {
  readonly id: string;
  readonly roomsWeight: Readonly<Record<string, number>>;
  readonly behaviorBias: Readonly<Record<string, number>>;
  readonly omenDurationMs: number;
  readonly burstDurationMsRange: readonly [number, number];
  readonly aftermathDurationMs: number;
  readonly materialResidue: WeatherResidueToken;
  readonly rarityGated: boolean;
}

interface ParsedWeatherSystem {
  readonly baseCooldownMsRange: readonly [number, number];
  readonly behaviorBiasClamp: number;
  readonly canonicalRoomIds: readonly string[];
  /** Lexicographically sorted class ids — the frozen selection iteration order. */
  readonly classOrder: readonly string[];
  readonly classes: Readonly<Record<string, WeatherClassDefinition>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requirePositiveIntegerMs(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive safe integer of milliseconds`);
  }
  return value as number;
}

function requireMsRange(value: unknown, path: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${path} must be a [minMs, maxMs] pair`);
  }
  const min = requirePositiveIntegerMs(value[0], `${path}[0]`);
  const max = requirePositiveIntegerMs(value[1], `${path}[1]`);
  if (min > max) throw new Error(`${path} must be ordered min <= max`);
  return Object.freeze([min, max] as [number, number]);
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function isWeatherResidueToken(value: string): value is WeatherResidueToken {
  return (WEATHER_RESIDUE_TOKENS as readonly string[]).includes(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Clamp one authored behaviorBias dimension into the presentation-only ±30%
 * envelope (`selection.behaviorBiasClamp` in weather-system-v4.json). The
 * clamp is applied at parse time so no caller can ever observe a bias value
 * outside the authored envelope.
 */
export function clampPresentationBias(value: number, clamp: number = 0.3): number {
  const magnitude = requireFiniteNumber(clamp, "behavior bias clamp");
  const bias = requireFiniteNumber(value, "behavior bias value");
  if (magnitude < 0) throw new Error("behavior bias clamp must be non-negative");
  if (bias > magnitude) return magnitude;
  if (bias < -magnitude) return -magnitude;
  return bias;
}

function parseWeatherSystem(value: unknown): ParsedWeatherSystem {
  const manifest = requireRecord(value, "weather system manifest");
  if (manifest.schemaVersion !== "4.0.0-weather") {
    throw new Error("weather system manifest schemaVersion is unsupported");
  }
  if (manifest.authority !== "world-presentation") {
    throw new Error("weather system manifest authority must be world-presentation");
  }
  const selection = requireRecord(manifest.selection, "weather system manifest.selection");
  const baseCooldownMsRange = requireMsRange(
    selection.baseCooldownMs,
    "weather system manifest.selection.baseCooldownMs",
  );
  const behaviorBiasClamp = requireFiniteNumber(
    selection.behaviorBiasClamp,
    "weather system manifest.selection.behaviorBiasClamp",
  );
  if (behaviorBiasClamp <= 0 || behaviorBiasClamp > 1) {
    throw new Error("weather system manifest.selection.behaviorBiasClamp must be in (0, 1]");
  }

  const weather = requireRecord(manifest.weather, "weather system manifest.weather");
  const classIds = Object.keys(weather);
  if (classIds.length === 0) throw new Error("weather system manifest declares no classes");
  const classOrder = Object.freeze(classIds.slice().sort(compareText));

  let canonicalRoomIds: readonly string[] | null = null;
  const classes: Record<string, WeatherClassDefinition> = Object.create(null) as Record<
    string,
    WeatherClassDefinition
  >;
  const seenResidues = new Set<string>();
  for (const classId of classOrder) {
    const path = `weather system manifest.weather.${classId}`;
    const definition = requireRecord(weather[classId], path);

    const roomsWeightRaw = requireRecord(definition.roomsWeight, `${path}.roomsWeight`);
    const roomIds = Object.freeze(Object.keys(roomsWeightRaw).sort(compareText));
    if (roomIds.length === 0) throw new Error(`${path}.roomsWeight must not be empty`);
    if (canonicalRoomIds === null) {
      canonicalRoomIds = roomIds;
    } else if (
      canonicalRoomIds.length !== roomIds.length
      || canonicalRoomIds.some((roomId, index) => roomId !== roomIds[index])
    ) {
      throw new Error(`${path}.roomsWeight rooms diverge from the other weather classes`);
    }
    const roomsWeight: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const roomId of roomIds) {
      const weight = requireFiniteNumber(roomsWeightRaw[roomId], `${path}.roomsWeight.${roomId}`);
      if (weight <= 0) throw new Error(`${path}.roomsWeight.${roomId} must be positive`);
      roomsWeight[roomId] = weight;
    }

    const behaviorBiasRaw = requireRecord(definition.behaviorBias, `${path}.behaviorBias`);
    const behaviorBias: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const dimension of Object.keys(behaviorBiasRaw).sort(compareText)) {
      behaviorBias[dimension] = clampPresentationBias(
        requireFiniteNumber(behaviorBiasRaw[dimension], `${path}.behaviorBias.${dimension}`),
        behaviorBiasClamp,
      );
    }

    const omen = requireRecord(definition.omen, `${path}.omen`);
    const burst = requireRecord(definition.burst, `${path}.burst`);
    const aftermath = requireRecord(definition.aftermath, `${path}.aftermath`);
    const materialResidue = requireNonEmptyString(
      aftermath.materialResidue,
      `${path}.aftermath.materialResidue`,
    );
    if (!isWeatherResidueToken(materialResidue)) {
      throw new Error(`${path}.aftermath.materialResidue is not a known residue token`);
    }
    if (seenResidues.has(materialResidue)) {
      throw new Error(`${path}.aftermath.materialResidue duplicates another class residue`);
    }
    seenResidues.add(materialResidue);

    const rarityGated = definition.rarityGate !== undefined;
    if (rarityGated) {
      requireNonEmptyString(definition.rarityGate, `${path}.rarityGate`);
    }

    classes[classId] = Object.freeze({
      id: classId,
      roomsWeight: Object.freeze(roomsWeight),
      behaviorBias: Object.freeze(behaviorBias),
      omenDurationMs: requirePositiveIntegerMs(omen.durationMs, `${path}.omen.durationMs`),
      burstDurationMsRange: requireMsRange(burst.durationMs, `${path}.burst.durationMs`),
      aftermathDurationMs: requirePositiveIntegerMs(
        aftermath.durationMs,
        `${path}.aftermath.durationMs`,
      ),
      materialResidue,
      rarityGated,
    });
  }
  if (canonicalRoomIds === null) throw new Error("weather system manifest declares no rooms");

  return Object.freeze({
    baseCooldownMsRange,
    behaviorBiasClamp,
    canonicalRoomIds,
    classOrder,
    classes: Object.freeze(classes),
  });
}

const WEATHER_SYSTEM = parseWeatherSystem(weatherSystemJson);

/**
 * ECLIPSE rarity gate, authored in weather-system-v4.json:
 * `run.elapsedMs >= 180000 && weather.completedCount >= 1`.
 *
 * Frozen interpretation (the manifest leaves the evaluation instant open):
 * the gate is evaluated at cycle-scheduling time against the tick where the
 * candidate omen would begin (the moment weather becomes perceivable), and
 * `completedCount` is run-scoped — every completed cycle in any room counts.
 */
export const ECLIPSE_MINIMUM_RUN_ELAPSED_MS = 180_000;
export const ECLIPSE_MINIMUM_COMPLETED_CYCLES = 1;

/**
 * Deterministic per-cycle seed composition — AUTHORED DECISION.
 *
 * weather-system-v4.json only says `hash(run.seed, room.visitIndex,
 * weather.ordinal)` and deliberately leaves the hash unspecified. This
 * composition is our frozen v1 choice and must never drift silently:
 *
 *   seed = runSeed
 *        ^ ((roomVisitIndex * 0x9E3779B9) mod 2^32)
 *        ^ ((weatherOrdinal * 0x85EBCA6B) mod 2^32)
 *   (all arithmetic in uint32; the result feeds Mulberry32.)
 *
 * Rationale: the two odd multiplicative constants (the golden-ratio Weyl
 * constant and the murmur3 fmix constant) spread small consecutive
 * visitIndex/ordinal integers across the full uint32 space before XOR
 * mixing, so visit 0/ordinal 1 and visit 1/ordinal 0 never collide the way
 * plain XOR of small integers would; Mulberry32 then owns all whitening.
 * `Math.imul` is the exact mod-2^32 product (a plain `*` would lose integer
 * identity past 2^53 before the `>>> 0`).
 */
export function composeWeatherCycleSeed(
  runSeed: number,
  roomVisitIndex: number,
  weatherOrdinal: number,
): number {
  return (
    (runSeed >>> 0)
    ^ (Math.imul(roomVisitIndex, 0x9e3779b9) >>> 0)
    ^ (Math.imul(weatherOrdinal, 0x85ebca6b) >>> 0)
  ) >>> 0;
}

/**
 * Mulberry32 — identical algorithm to the canonical `mulberry32-v1` used by
 * encounters.ts / run-composer.ts. Those modules keep their generator private
 * (no export exists), and this island may not edit their files, so the
 * algorithm is restated verbatim here; any drift is a determinism defect.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function drawIntegerMsInclusive(
  random: () => number,
  range: readonly [number, number],
): number {
  return range[0] + Math.floor(random() * (range[1] - range[0] + 1));
}

interface ScheduledWeatherCycle {
  readonly ordinal: number;
  readonly classId: string;
  readonly cooldownMs: number;
  readonly cooldownBeginTick120: number;
  readonly omenTick120: number;
  readonly activeTick120: number;
  readonly aftermathTick120: number;
  readonly completeTick120: number;
}

interface RoomContext {
  readonly roomId: string;
  readonly visitIndex: number;
  readonly entryOrdinal: number;
}

type CycleBoundaryKind = "omen" | "active" | "aftermath" | "complete";

const CYCLE_BOUNDARY_ORDER = Object.freeze([
  "omen",
  "active",
  "aftermath",
  "complete",
] as const);

export class WeatherScheduler {
  readonly #bus: CanonicalEventBus;
  readonly #runSeed: number;
  readonly #biasView: WeatherPresentationBiasView;

  #currentTick120 = 0;
  #phase: WeatherPhase = "idle";
  #room: RoomContext | null = null;
  #cycle: ScheduledWeatherCycle | null = null;
  #nextBoundaryIndex = 0;
  #completedCycleCount = 0;
  #nextEntryOrdinal = 0;
  #nextLocalSequence = 0;
  #residues: WeatherResidueFact[] = [];

  constructor(bus: CanonicalEventBus, runSeed: number) {
    if (!isExactCanonicalEventBus(bus)) {
      throw new Error("weather scheduler requires the exact canonical event bus");
    }
    if (
      !Number.isSafeInteger(runSeed)
      || runSeed < 0
      || runSeed > 0xffff_ffff
      || Object.is(runSeed, -0)
    ) {
      throw new Error("weather scheduler runSeed must be a uint32");
    }
    this.#bus = bus;
    this.#runSeed = runSeed >>> 0;

    const biasView: Record<string, Readonly<Record<string, number>>> = Object.create(
      null,
    ) as Record<string, Readonly<Record<string, number>>>;
    for (const classId of WEATHER_SYSTEM.classOrder) {
      const definition = WEATHER_SYSTEM.classes[classId];
      if (definition === undefined) throw new Error(`weather class vanished: ${classId}`);
      biasView[classId] = definition.behaviorBias;
    }
    this.#biasView = Object.freeze(biasView);
  }

  enterRoom(roomIdValue: string, visitIndexValue: number, tick120Value: number): void {
    const roomId = requireNonEmptyString(roomIdValue, "weather scheduler roomId");
    if (!WEATHER_SYSTEM.canonicalRoomIds.includes(roomId)) {
      throw new Error(`weather scheduler received an unknown room id: ${roomId}`);
    }
    if (!Number.isSafeInteger(visitIndexValue) || visitIndexValue < 0) {
      throw new Error("weather scheduler visitIndex must be a non-negative safe integer");
    }
    const tick120 = this.#requireForwardTick(tick120Value, "weather scheduler enterRoom tick120");

    // Room exit truncates any in-flight cycle: no completion is counted and
    // residues are room-local, so the slate is cleared before rescheduling.
    this.#currentTick120 = tick120;
    this.#room = Object.freeze({
      roomId,
      visitIndex: visitIndexValue,
      entryOrdinal: this.#nextEntryOrdinal,
    });
    this.#nextEntryOrdinal += 1;
    this.#residues = [];
    this.#scheduleCycle(tick120, 0);
  }

  advanceTo(tick120Value: number): void {
    const tick120 = this.#requireForwardTick(tick120Value, "weather scheduler advanceTo tick120");
    this.#currentTick120 = tick120;
    if (this.#room === null) return;

    while (this.#cycle !== null) {
      const boundary = CYCLE_BOUNDARY_ORDER[this.#nextBoundaryIndex];
      if (boundary === undefined) throw new Error("weather cycle boundary cursor overflowed");
      const dueTick = this.#boundaryTick(this.#cycle, boundary);
      if (dueTick > tick120) break;
      this.#fireBoundary(this.#cycle, boundary, dueTick);
    }
  }

  snapshot(): WeatherSchedulerSnapshot {
    const visibleClass = this.#phase === "omen" || this.#phase === "active" || this.#phase === "aftermath"
      ? this.#cycle?.classId ?? null
      : null;
    return Object.freeze({
      authority: "weather-presentation",
      tick120: this.#currentTick120,
      phase: this.#phase,
      classId: visibleClass,
      biasView: this.#biasView,
      residues: Object.freeze(this.#residues.slice()),
      witnessFacePlayerException: this.#phase === "active" && visibleClass === "ECLIPSE",
    });
  }

  #requireForwardTick(value: number, path: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new Error(`${path} must be a non-negative safe integer`);
    }
    if (value < this.#currentTick120) {
      throw new Error(`${path} must not move backward: ${this.#currentTick120} -> ${value}`);
    }
    return value;
  }

  #boundaryTick(cycle: ScheduledWeatherCycle, boundary: CycleBoundaryKind): number {
    switch (boundary) {
      case "omen":
        return cycle.omenTick120;
      case "active":
        return cycle.activeTick120;
      case "aftermath":
        return cycle.aftermathTick120;
      case "complete":
        return cycle.completeTick120;
    }
  }

  #scheduleCycle(startTick120: number, ordinal: number): void {
    const room = this.#room;
    if (room === null) throw new Error("weather cycle cannot be scheduled without a room");
    const definitionSeed = composeWeatherCycleSeed(this.#runSeed, room.visitIndex, ordinal);

    // One private stream per cycle occurrence; fixed draw order:
    // 1) cooldown duration, 2) class selection, 3) burst duration.
    const random = mulberry32(definitionSeed);
    const cooldownMs = drawIntegerMsInclusive(random, WEATHER_SYSTEM.baseCooldownMsRange);
    const omenTick120 = startTick120 + crossedTickCount(cooldownMs);

    const eclipseEligible = simulationTimeMsForTick(omenTick120) >= ECLIPSE_MINIMUM_RUN_ELAPSED_MS
      && this.#completedCycleCount >= ECLIPSE_MINIMUM_COMPLETED_CYCLES;
    const classId = this.#drawClass(random, room.roomId, eclipseEligible);
    const definition = WEATHER_SYSTEM.classes[classId];
    if (definition === undefined) throw new Error(`weather class vanished: ${classId}`);
    const burstMs = drawIntegerMsInclusive(random, definition.burstDurationMsRange);

    const activeTick120 = omenTick120 + crossedTickCount(definition.omenDurationMs);
    const aftermathTick120 = activeTick120 + crossedTickCount(burstMs);
    const completeTick120 = aftermathTick120 + crossedTickCount(definition.aftermathDurationMs);

    this.#cycle = Object.freeze({
      ordinal,
      classId,
      cooldownMs,
      cooldownBeginTick120: startTick120,
      omenTick120,
      activeTick120,
      aftermathTick120,
      completeTick120,
    });
    this.#nextBoundaryIndex = 0;
    this.#phase = "cooldown";
    this.#enqueue("weather.cooldown.begin", startTick120, ordinal, "cooldown", {
      weather: classId,
      cycle: ordinal,
      roomId: room.roomId,
      visitIndex: room.visitIndex,
      cooldownMs,
    });
  }

  #drawClass(random: () => number, roomId: string, eclipseEligible: boolean): string {
    // Frozen iteration order: class ids sorted lexicographically (see
    // parseWeatherSystem), independent of manifest JSON key order.
    const eligible = WEATHER_SYSTEM.classOrder.filter((classId) => {
      const definition = WEATHER_SYSTEM.classes[classId];
      if (definition === undefined) throw new Error(`weather class vanished: ${classId}`);
      return definition.rarityGated ? eclipseEligible : true;
    });
    if (eligible.length === 0) throw new Error("no weather class is eligible for selection");

    let total = 0;
    for (const classId of eligible) {
      const weight = WEATHER_SYSTEM.classes[classId]?.roomsWeight[roomId];
      if (weight === undefined) {
        throw new Error(`weather class ${classId} has no weight for room ${roomId}`);
      }
      total += weight;
    }
    let remaining = random() * total;
    for (const classId of eligible) {
      const weight = WEATHER_SYSTEM.classes[classId]?.roomsWeight[roomId];
      if (weight === undefined) {
        throw new Error(`weather class ${classId} has no weight for room ${roomId}`);
      }
      remaining -= weight;
      if (remaining < 0) return classId;
    }
    const last = eligible[eligible.length - 1];
    if (last === undefined) throw new Error("no weather class is eligible for selection");
    return last;
  }

  #fireBoundary(
    cycle: ScheduledWeatherCycle,
    boundary: CycleBoundaryKind,
    dueTick120: number,
  ): void {
    const room = this.#room;
    if (room === null) throw new Error("weather boundary cannot fire without a room");
    const definition = WEATHER_SYSTEM.classes[cycle.classId];
    if (definition === undefined) throw new Error(`weather class vanished: ${cycle.classId}`);

    switch (boundary) {
      case "omen": {
        this.#enqueue("weather.omen.begin", dueTick120, cycle.ordinal, "omen", {
          weather: cycle.classId,
          cycle: cycle.ordinal,
          activeAtMs: simulationTimeMsForTick(cycle.activeTick120),
          roomId: room.roomId,
        });
        this.#phase = "omen";
        this.#nextBoundaryIndex += 1;
        return;
      }
      case "active": {
        this.#enqueue("weather.active.begin", dueTick120, cycle.ordinal, "active", {
          weather: cycle.classId,
          cycle: cycle.ordinal,
          roomId: room.roomId,
        });
        this.#phase = "active";
        this.#nextBoundaryIndex += 1;
        return;
      }
      case "aftermath": {
        this.#enqueue("weather.aftermath.begin", dueTick120, cycle.ordinal, "aftermath", {
          weather: cycle.classId,
          cycle: cycle.ordinal,
          residue: definition.materialResidue,
          roomId: room.roomId,
        });
        this.#residues.push(Object.freeze({
          weather: cycle.classId,
          residue: definition.materialResidue,
          cycle: cycle.ordinal,
          tick120: dueTick120,
          persistence: "room-local",
        }));
        this.#phase = "aftermath";
        this.#nextBoundaryIndex += 1;
        return;
      }
      case "complete": {
        this.#enqueue("weather.complete", dueTick120, cycle.ordinal, "complete", {
          weather: cycle.classId,
          cycle: cycle.ordinal,
          roomId: room.roomId,
        });
        this.#completedCycleCount += 1;
        this.#scheduleCycle(dueTick120, cycle.ordinal + 1);
        return;
      }
    }
  }

  #enqueue(
    id: string,
    tick120: number,
    cycleOrdinal: number,
    suffix: string,
    payload: Record<string, string | number>,
  ): void {
    const room = this.#room;
    if (room === null) throw new Error("weather events require an entered room");
    const localSequence = this.#nextLocalSequence;
    this.#nextLocalSequence += 1;
    const draft: GameplayEventDraft = {
      id,
      tick120,
      entityStableId: WEATHER_SCHEDULER_ENTITY_ID,
      localSequence,
      occurrenceKey:
        `${WEATHER_SCHEDULER_ENTITY_ID}:${room.entryOrdinal}:${room.roomId}:${room.visitIndex}:${cycleOrdinal}:${suffix}`,
      payload,
    };
    this.#bus.enqueueBatch([draft]);
  }
}
