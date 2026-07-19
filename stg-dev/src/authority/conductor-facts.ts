/**
 * Manifest-authored facts the run conductor drives the narrative FSM with.
 *
 * Nothing here invents content. Every number, room, threshold, hysteresis pair
 * and compound gate is read out of room-thresholds-v4.json at module load and
 * validated fail-closed; a drifted manifest throws before a run can start.
 *
 * The conductor keeps this file separate from conductor.ts so the "what is
 * authored" layer stays auditable next to the "how a run is driven" layer.
 */

import roomThresholdJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/room-thresholds-v4.json";
import {CANONICAL_EVENT_REGISTRY, type CanonicalEventId} from "./events";
import {crossedTickCount} from "./tick120";

export type ConductorRoomId =
  | "INFORMATION"
  | "FORCED_ALIGNMENT"
  | "IN_BETWEEN"
  | "POLARIZED";

export const CONDUCTOR_ROOM_IDS: readonly ConductorRoomId[] = Object.freeze([
  "INFORMATION",
  "FORCED_ALIGNMENT",
  "IN_BETWEEN",
  "POLARIZED",
]);

export type ThresholdOperator = ">=" | ">" | "<=" | "<";

export interface AuthoredEntryOmen {
  readonly roomId: ConductorRoomId;
  readonly distancePx: number;
  readonly event: string;
  readonly audioLeadMs: number;
  /** Integer tick120 lead derived by round-up; never a float schedule. */
  readonly audioLeadTicks120: number;
}

/** A single-metric hysteresis band: enter on `enter`, leave only past `exit`. */
export interface AuthoredHysteresisThreshold {
  readonly kind: "hysteresis";
  readonly roomId: ConductorRoomId;
  readonly id: string;
  readonly metric: string;
  readonly operator: ThresholdOperator;
  readonly enter: number;
  /** Null when the manifest authors no release edge (one-way commit). */
  readonly exit: number | null;
  readonly minimumHoldTicks120: number;
  readonly cooldownTicks120: number;
  readonly reaction: string;
}

/** A compound `all` gate (the POLARIZED Override eligibility contract). */
export interface AuthoredCompoundClause {
  readonly metric: string;
  readonly operator: ThresholdOperator;
  readonly value: number;
}

export interface AuthoredCompoundThreshold {
  readonly kind: "compound";
  readonly roomId: ConductorRoomId;
  readonly id: string;
  readonly clauses: readonly AuthoredCompoundClause[];
  readonly reaction: string;
}

export type AuthoredThreshold = AuthoredHysteresisThreshold | AuthoredCompoundThreshold;

export interface AuthoredRoomThresholds {
  readonly roomId: ConductorRoomId;
  readonly worldName: string;
  readonly entryOmen: AuthoredEntryOmen;
  readonly thresholds: readonly AuthoredThreshold[];
}

export interface AuthoredTransitionContract {
  readonly visualCrossfadeMs: number;
  readonly audioCrossfadeMs: number;
  readonly collisionSource: string;
  readonly noMidpointAmbiguity: boolean;
}

const OPERATORS: readonly ThresholdOperator[] = Object.freeze([">=", ">", "<=", "<"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireOperator(value: unknown, path: string): ThresholdOperator {
  if (value === undefined) return ">=";
  const operator = requireNonEmptyString(value, path);
  if (!OPERATORS.includes(operator as ThresholdOperator)) {
    throw new Error(`${path} must be one of ${OPERATORS.join(", ")}`);
  }
  return operator as ThresholdOperator;
}

function parseCompoundThreshold(
  roomId: ConductorRoomId,
  id: string,
  raw: Record<string, unknown>,
): AuthoredCompoundThreshold {
  const clausesValue = raw.all;
  if (!Array.isArray(clausesValue) || clausesValue.length === 0) {
    throw new Error(`room threshold ${id}.all must be a non-empty array`);
  }
  const clauses = clausesValue.map((entry, index) => {
    const clause = requireRecord(entry, `room threshold ${id}.all[${index}]`);
    return Object.freeze({
      metric: requireNonEmptyString(clause.metric, `room threshold ${id}.all[${index}].metric`),
      operator: requireOperator(clause.operator, `room threshold ${id}.all[${index}].operator`),
      value: requireFiniteNumber(clause.value, `room threshold ${id}.all[${index}].value`),
    });
  });
  return Object.freeze({
    kind: "compound" as const,
    roomId,
    id,
    clauses: Object.freeze(clauses),
    reaction: requireNonEmptyString(raw.reaction, `room threshold ${id}.reaction`),
  });
}

function parseThreshold(roomId: ConductorRoomId, value: unknown, index: number): AuthoredThreshold {
  const raw = requireRecord(value, `${roomId} threshold[${index}]`);
  const id = requireNonEmptyString(raw.id, `${roomId} threshold[${index}].id`);
  if (raw.all !== undefined) return parseCompoundThreshold(roomId, id, raw);
  return Object.freeze({
    kind: "hysteresis" as const,
    roomId,
    id,
    metric: requireNonEmptyString(raw.metric, `room threshold ${id}.metric`),
    operator: requireOperator(raw.operator, `room threshold ${id}.operator`),
    enter: requireFiniteNumber(raw.enter, `room threshold ${id}.enter`),
    exit: raw.exit === undefined
      ? null
      : requireFiniteNumber(raw.exit, `room threshold ${id}.exit`),
    minimumHoldTicks120: raw.minimumHoldMs === undefined
      ? 0
      : crossedTickCount(requireNonNegativeInteger(raw.minimumHoldMs, `room threshold ${id}.minimumHoldMs`)),
    cooldownTicks120: raw.cooldownMs === undefined
      ? 0
      : crossedTickCount(requireNonNegativeInteger(raw.cooldownMs, `room threshold ${id}.cooldownMs`)),
    reaction: requireNonEmptyString(raw.reaction, `room threshold ${id}.reaction`),
  });
}

function parseRoomThresholds(): ReadonlyMap<ConductorRoomId, AuthoredRoomThresholds> {
  const manifest = requireRecord(roomThresholdJson, "room thresholds manifest");
  if (manifest.schemaVersion !== "4.0.0-room-thresholds") {
    throw new Error("room thresholds manifest identity drifted");
  }
  const rooms = requireRecord(manifest.rooms, "room thresholds rooms");
  const authoredRoomIds = Object.keys(rooms);
  if (
    authoredRoomIds.length !== CONDUCTOR_ROOM_IDS.length
    || CONDUCTOR_ROOM_IDS.some((roomId) => !authoredRoomIds.includes(roomId))
  ) {
    throw new Error("room thresholds manifest does not author the four canonical rooms");
  }
  const parsed = new Map<ConductorRoomId, AuthoredRoomThresholds>();
  for (const roomId of CONDUCTOR_ROOM_IDS) {
    const room = requireRecord(rooms[roomId], `room thresholds ${roomId}`);
    const omen = requireRecord(room.entryOmen, `room thresholds ${roomId}.entryOmen`);
    const audioLeadMs = requireNonNegativeInteger(
      omen.audioLeadMs,
      `room thresholds ${roomId}.entryOmen.audioLeadMs`,
    );
    const thresholdList = room.thresholds;
    if (!Array.isArray(thresholdList) || thresholdList.length === 0) {
      throw new Error(`room thresholds ${roomId}.thresholds must be a non-empty array`);
    }
    parsed.set(roomId, Object.freeze({
      roomId,
      worldName: requireNonEmptyString(room.worldName, `room thresholds ${roomId}.worldName`),
      entryOmen: Object.freeze({
        roomId,
        distancePx: requireFiniteNumber(omen.distancePx, `room thresholds ${roomId}.entryOmen.distancePx`),
        event: requireNonEmptyString(omen.event, `room thresholds ${roomId}.entryOmen.event`),
        audioLeadMs,
        audioLeadTicks120: crossedTickCount(audioLeadMs),
      }),
      thresholds: Object.freeze(
        thresholdList.map((entry, index) => parseThreshold(roomId, entry, index)),
      ),
    }));
  }
  return parsed;
}

export const AUTHORED_ROOM_THRESHOLD_FACTS = parseRoomThresholds();

function parseTransitionContract(): AuthoredTransitionContract {
  const manifest = requireRecord(roomThresholdJson, "room thresholds manifest");
  const contract = requireRecord(manifest.transitionContract, "room thresholds transitionContract");
  if (contract.noMidpointAmbiguity !== true) {
    throw new Error("room transition contract must forbid midpoint collision ambiguity");
  }
  return Object.freeze({
    visualCrossfadeMs: requireNonNegativeInteger(contract.visualCrossfadeMs, "transitionContract.visualCrossfadeMs"),
    audioCrossfadeMs: requireNonNegativeInteger(contract.audioCrossfadeMs, "transitionContract.audioCrossfadeMs"),
    collisionSource: requireNonEmptyString(contract.collisionSource, "transitionContract.collisionSource"),
    noMidpointAmbiguity: true,
  });
}

export const AUTHORED_TRANSITION_CONTRACT = parseTransitionContract();

/**
 * The Override eligibility gate is authored, not invented: POLARIZED's
 * `polar.override-eligible` compound clause set. The conductor reads it here
 * so the compound gate can never drift from the manifest.
 */
export const OVERRIDE_ELIGIBILITY_GATE: AuthoredCompoundThreshold = (() => {
  const polarized = AUTHORED_ROOM_THRESHOLD_FACTS.get("POLARIZED");
  if (polarized === undefined) throw new Error("POLARIZED room thresholds are not authored");
  const gate = polarized.thresholds.find(
    (threshold): threshold is AuthoredCompoundThreshold =>
      threshold.kind === "compound" && threshold.id === "polar.override-eligible",
  );
  if (gate === undefined) {
    throw new Error("POLARIZED must author the polar.override-eligible compound gate");
  }
  if (gate.clauses.length !== 3) {
    throw new Error("Override eligibility must remain a three-clause compound gate");
  }
  return gate;
})();

export function evaluateThresholdComparison(
  sample: number,
  operator: ThresholdOperator,
  bound: number,
): boolean {
  if (!Number.isFinite(sample)) throw new Error("threshold sample must be finite");
  switch (operator) {
    case ">=": return sample >= bound;
    case ">": return sample > bound;
    case "<=": return sample <= bound;
    case "<": return sample < bound;
    default: {
      const exhaustive: never = operator;
      throw new Error(`unsupported threshold operator: ${String(exhaustive)}`);
    }
  }
}

/** Release uses the mirrored operator so the exit band is the actual release edge. */
function releaseOperator(operator: ThresholdOperator): ThresholdOperator {
  switch (operator) {
    case ">=": return "<";
    case ">": return "<=";
    case "<=": return ">";
    case "<": return ">=";
    default: {
      const exhaustive: never = operator;
      throw new Error(`unsupported threshold operator: ${String(exhaustive)}`);
    }
  }
}

export interface ThresholdCrossing {
  readonly thresholdId: string;
  readonly roomId: ConductorRoomId;
  readonly reaction: string;
  readonly edge: "enter" | "exit";
  readonly tick120: number;
}

interface ThresholdRuntimeState {
  armed: boolean;
  /** Tick the enter comparison first became true (minimumHold gate). */
  candidateSinceTick120: number | null;
  /** Earliest tick a new enter edge may commit again (cooldown gate). */
  readyAtTick120: number;
}

/**
 * Per-room hysteresis watcher over a metric bag. Enter and exit are distinct
 * authored edges; a metric oscillating inside the band produces no events,
 * which is exactly what "hysteresis" buys the world reaction graph.
 *
 * Compound (`all`) thresholds have no release band in the manifest, so they
 * latch on first satisfaction and are reported once per room visit.
 */
export class RoomThresholdWatcher {
  readonly roomId: ConductorRoomId;

  private readonly authored: AuthoredRoomThresholds;
  private readonly states = new Map<string, ThresholdRuntimeState>();
  private lastTick120: number | null = null;

  constructor(roomIdValue: unknown) {
    const roomId = requireNonEmptyString(roomIdValue, "threshold watcher room id");
    if (!CONDUCTOR_ROOM_IDS.includes(roomId as ConductorRoomId)) {
      throw new Error(`threshold watcher room is not authored: ${roomId}`);
    }
    const authored = AUTHORED_ROOM_THRESHOLD_FACTS.get(roomId as ConductorRoomId);
    if (authored === undefined) throw new Error(`room thresholds are missing for ${roomId}`);
    this.roomId = roomId as ConductorRoomId;
    this.authored = authored;
    for (const threshold of authored.thresholds) {
      this.states.set(threshold.id, {armed: false, candidateSinceTick120: null, readyAtTick120: 0});
    }
  }

  get entryOmen(): AuthoredEntryOmen {
    return this.authored.entryOmen;
  }

  /**
   * Sample every authored threshold for this room at one exact tick. Metrics
   * the caller does not supply are absent, not zero: an absent metric can
   * neither enter nor exit (fail closed, never a fabricated crossing).
   */
  observe(
    metrics: Readonly<Record<string, number>>,
    tick120Value: number,
  ): readonly ThresholdCrossing[] {
    const tick120 = requireNonNegativeInteger(tick120Value, "threshold observe tick120");
    if (this.lastTick120 !== null && tick120 < this.lastTick120) {
      throw new Error("threshold watcher cannot observe a backward tick");
    }
    this.lastTick120 = tick120;
    const crossings: ThresholdCrossing[] = [];
    for (const threshold of this.authored.thresholds) {
      const state = this.states.get(threshold.id);
      if (state === undefined) throw new Error(`threshold state lost: ${threshold.id}`);
      if (threshold.kind === "compound") {
        if (state.armed) continue;
        const satisfied = threshold.clauses.every((clause) => {
          const sample = metrics[clause.metric];
          return sample !== undefined
            && evaluateThresholdComparison(sample, clause.operator, clause.value);
        });
        if (!satisfied) continue;
        state.armed = true;
        crossings.push(Object.freeze({
          thresholdId: threshold.id,
          roomId: this.roomId,
          reaction: threshold.reaction,
          edge: "enter" as const,
          tick120,
        }));
        continue;
      }
      const sample = metrics[threshold.metric];
      if (sample === undefined) {
        state.candidateSinceTick120 = null;
        continue;
      }
      if (state.armed) {
        if (threshold.exit === null) continue;
        const released = evaluateThresholdComparison(
          sample,
          releaseOperator(threshold.operator),
          threshold.exit,
        );
        if (!released) continue;
        state.armed = false;
        state.candidateSinceTick120 = null;
        state.readyAtTick120 = tick120 + threshold.cooldownTicks120;
        crossings.push(Object.freeze({
          thresholdId: threshold.id,
          roomId: this.roomId,
          reaction: threshold.reaction,
          edge: "exit" as const,
          tick120,
        }));
        continue;
      }
      const entering = evaluateThresholdComparison(sample, threshold.operator, threshold.enter);
      if (!entering) {
        state.candidateSinceTick120 = null;
        continue;
      }
      if (tick120 < state.readyAtTick120) continue;
      if (state.candidateSinceTick120 === null) state.candidateSinceTick120 = tick120;
      if (tick120 - state.candidateSinceTick120 < threshold.minimumHoldTicks120) continue;
      state.armed = true;
      state.candidateSinceTick120 = null;
      crossings.push(Object.freeze({
        thresholdId: threshold.id,
        roomId: this.roomId,
        reaction: threshold.reaction,
        edge: "enter" as const,
        tick120,
      }));
    }
    return Object.freeze(crossings);
  }

  armedThresholdIds(): readonly string[] {
    const armed: string[] = [];
    for (const threshold of this.authored.thresholds) {
      if (this.states.get(threshold.id)?.armed === true) armed.push(threshold.id);
    }
    return Object.freeze(armed);
  }
}

/**
 * Narrative FSM enter/exit event names are authored narrative facts. Only a
 * subset of them exists in event-schema-v4.json; those are written to the
 * canonical bus, and the rest stay narrative-layer facts on the conductor's
 * own frozen log. Nothing is invented in either direction: membership is
 * decided by the canonical registry, once, at module load.
 */
export function canonicalEventIdForNarrativeEvent(name: string): CanonicalEventId | null {
  const canonical = Object.prototype.hasOwnProperty.call(CANONICAL_EVENT_REGISTRY, name);
  return canonical ? (name as CanonicalEventId) : null;
}
