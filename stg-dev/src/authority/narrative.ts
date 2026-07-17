import bossResolutionJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/boss-resolutions-v4.json";
import narrativeStateJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/narrative-state-machine-v4.json";
import roomThresholdJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/room-thresholds-v4.json";
import snapshotObservationJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/snapshot-observations-v4.json";
import weatherSystemJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/weather-system-v4.json";
import worldReactionJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/world-reaction-graph-v4.json";
import witnessConditionJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/witness-conditions-v4.json";
import eventSchemaJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";
import runtimeStateMachineJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";
import {
  assertCanonicalEventEnvelope,
  CANONICAL_EVENT_IDS,
  type CanonicalGameplayEvent,
  type JsonObject,
  type JsonValue,
} from "./events";

type Dictionary = Record<string, unknown>;

export type NarrativeRoomId = keyof typeof roomThresholdJson.rooms;
export const NARRATIVE_ROOM_IDS = Object.freeze(
  Object.keys(roomThresholdJson.rooms) as NarrativeRoomId[],
);

export type NarrativeWeatherId = keyof typeof weatherSystemJson.weather;
export const NARRATIVE_WEATHER_IDS = Object.freeze(
  Object.keys(weatherSystemJson.weather) as NarrativeWeatherId[],
);

export const NARRATIVE_STATE_IDS = Object.freeze(Object.keys(narrativeStateJson.states));
export type NarrativeStateId = (typeof NARRATIVE_STATE_IDS)[number];

export interface RoomThresholdDefinition {
  readonly roomId: NarrativeRoomId;
  readonly id: string;
  readonly metric: string | null;
  readonly reaction: string;
}

export interface BossResolutionDefinition {
  readonly bossId: string;
  readonly resolutionId: string;
  readonly fact: string;
  readonly terminalEvent: string;
  readonly materialRemainder: string;
}

export interface WorldReactionEdge {
  readonly from: string;
  readonly to: string;
  readonly event: string;
}

export interface AuthoredObservationDefinition {
  readonly id: string;
  readonly category: string;
  readonly priority: number;
  readonly condition: string;
  readonly trace: readonly string[];
  readonly zhCN: string;
  readonly en: string;
}

export interface SelectedObservation {
  readonly id: string;
  readonly category: string;
  readonly zhCN: string;
  readonly en: string;
  readonly trace: readonly {
    readonly path: string;
    readonly value: JsonValue;
  }[];
}

export interface NarrativeTransitionProjection {
  readonly from: NarrativeStateId;
  readonly to: NarrativeStateId;
  readonly tick120: number;
  readonly occurrenceKey: string;
  readonly order: number;
  readonly cues: readonly string[];
}

export interface WorldReactionProjection extends WorldReactionEdge {
  readonly sourceOccurrenceKey: string;
  readonly tick120: number;
  readonly order: number;
}

export interface BossResolutionProjection extends BossResolutionDefinition {
  readonly tick120: number;
  readonly occurrenceKey: string;
  readonly order: number;
}

export type NarrativeWeatherPhase = "OMEN" | "BURST" | "AFTERMATH" | "COOLDOWN" | "COMPLETE";

export interface WeatherProjection {
  readonly weather: NarrativeWeatherId;
  readonly cycle: number;
  readonly phase: NarrativeWeatherPhase;
  readonly tick120: number;
  readonly occurrenceKey: string;
}

export interface CrossRunProjection {
  readonly eventId: string;
  readonly fromRunId: string;
  readonly nextRunId: string | null;
  readonly recordCount: number | null;
  readonly routeDigest: string | null;
  readonly tick120: number;
  readonly occurrenceKey: string;
  readonly order: number;
}

export interface NarrativeSnapshot {
  readonly authority: "narrative-projection";
  readonly state: NarrativeStateId;
  readonly activeRoom: NarrativeRoomId | null;
  readonly visitedRooms: readonly NarrativeRoomId[];
  readonly weather: WeatherProjection | null;
  readonly bossResolutions: readonly BossResolutionProjection[];
  readonly reactions: readonly WorldReactionProjection[];
  readonly transitions: readonly NarrativeTransitionProjection[];
  readonly crossRun: readonly CrossRunProjection[];
  readonly observations: readonly SelectedObservation[];
  readonly handoffReady: boolean;
  readonly processedOccurrences: number;
  readonly lastTick120: number | null;
}

export interface NarrativeAuthorityReport {
  readonly narrativeStates: number;
  readonly roomThresholds: number;
  readonly bossResolutions: number;
  readonly snapshotObservations: number;
  readonly weatherTypes: number;
  readonly worldReactionEdges: number;
  readonly witnessStates: number;
  readonly canonicalEvents: number;
  readonly runtimeMachines: number;
  readonly compiledObservationConditions: number;
  readonly manifestGaps: readonly string[];
}

export interface NarrativeRecord {
  readonly run: {
    readonly id: string;
    readonly seed: number;
  };
  readonly fingerprint: {
    readonly digestSha256: string;
  };
  readonly materialMemory: {
    readonly overrideScars: readonly unknown[];
    readonly deathTraces: readonly unknown[];
    readonly burnIns: readonly unknown[];
    readonly ghostResidues: readonly unknown[];
  };
  readonly ghostRoute: null | {
    readonly routeDigest: string;
    readonly points: readonly {
      readonly tMs: number;
    }[];
  };
  readonly [key: string]: unknown;
}

/** Application-owned schema validation injected at the authority boundary. */
export type NarrativeRecordValidator = (value: unknown) => void;

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function isRecord(value: unknown): value is Dictionary {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Dictionary {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
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
  const number = requireFiniteNumber(value, path);
  if (!Number.isSafeInteger(number) || number < 0 || Object.is(number, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return number;
}

function requireStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return Object.freeze(value.map((entry, index) => requireString(entry, `${path}[${index}]`)));
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Dictionary)[key as string]);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function frozenClone<T>(value: T): Readonly<T> {
  return deepFreeze(cloneJson(value));
}

function canonicalize(value: unknown, path = "narrative snapshot"): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => canonicalize(entry, `${path}[${index}]`)));
  }
  if (!isRecord(value)) throw new Error(`${path} contains a non-JSON value`);
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(value).sort(compareCodePoint)) {
    result[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return Object.freeze(result);
}

export function serializeNarrativeSnapshot(snapshot: NarrativeSnapshot): string {
  return JSON.stringify(canonicalize(snapshot));
}

const FORBIDDEN_OUTPUT_PATTERNS = [
  /\bscore\b/iu,
  /\brank\b/iu,
  /\bvictory\b/iu,
  /\bdefeat\b/iu,
  /\bsuccess\b/iu,
  /\bfailure\b/iu,
  /\bperfect\b/iu,
  /\bgood(?:\s+ending)?\b/iu,
  /\bbad(?:\s+ending)?\b/iu,
  /得分|评分|排名|胜利|失败|完美|好结局|坏结局/u,
] as const;

function assertObservationalLanguage(value: unknown, path: string): void {
  const text = JSON.stringify(value);
  for (const pattern of FORBIDDEN_OUTPUT_PATTERNS) {
    if (pattern.test(text)) throw new Error(`${path} contains evaluative second-language output`);
  }
}

function parseRoomThresholds(): readonly RoomThresholdDefinition[] {
  const root = requireRecord(roomThresholdJson, "room threshold manifest");
  if (root.schemaVersion !== "4.0.0-room-thresholds") throw new Error("unsupported room threshold schema");
  const rooms = requireRecord(root.rooms, "room threshold manifest.rooms");
  const result: RoomThresholdDefinition[] = [];
  const ids = new Set<string>();
  for (const roomId of NARRATIVE_ROOM_IDS) {
    const room = requireRecord(rooms[roomId], `room threshold manifest.rooms.${roomId}`);
    if (!Array.isArray(room.thresholds)) throw new Error(`${roomId} thresholds must be an array`);
    for (const [index, rawThreshold] of room.thresholds.entries()) {
      const threshold = requireRecord(rawThreshold, `${roomId}.thresholds[${index}]`);
      const id = requireString(threshold.id, `${roomId}.thresholds[${index}].id`);
      if (ids.has(id)) throw new Error(`duplicate room threshold id: ${id}`);
      ids.add(id);
      result.push(Object.freeze({
        roomId,
        id,
        metric: typeof threshold.metric === "string" ? threshold.metric : null,
        reaction: requireString(threshold.reaction, `${id}.reaction`),
      }));
    }
  }
  if (Object.keys(rooms).some((id) => !NARRATIVE_ROOM_IDS.includes(id as NarrativeRoomId))) {
    throw new Error("room threshold manifest contains an unknown room id");
  }
  return Object.freeze(result);
}

function parseBossResolutions(): readonly BossResolutionDefinition[] {
  const root = requireRecord(bossResolutionJson, "boss resolution manifest");
  if (root.schemaVersion !== "4.0.0-boss-resolutions") throw new Error("unsupported boss resolution schema");
  if (!Array.isArray(root.bosses)) throw new Error("boss resolution manifest.bosses must be an array");
  const bossIds = new Set<string>();
  const resolutionIds = new Set<string>();
  const result = root.bosses.map((rawBoss, index) => {
    const boss = requireRecord(rawBoss, `boss resolution manifest.bosses[${index}]`);
    const bossId = requireString(boss.id, `bosses[${index}].id`);
    const resolutionId = requireString(boss.resolutionId, `bosses[${index}].resolutionId`);
    if (bossIds.has(bossId)) throw new Error(`duplicate boss id: ${bossId}`);
    if (resolutionIds.has(resolutionId)) throw new Error(`duplicate boss resolution id: ${resolutionId}`);
    bossIds.add(bossId);
    resolutionIds.add(resolutionId);
    const definition = Object.freeze({
      bossId,
      resolutionId,
      fact: requireString(boss.fact, `${bossId}.fact`),
      terminalEvent: requireString(boss.terminalEvent, `${bossId}.terminalEvent`),
      materialRemainder: requireString(boss.materialRemainder, `${bossId}.materialRemainder`),
    });
    assertObservationalLanguage(definition, `boss resolution ${bossId}`);
    return definition;
  });
  return Object.freeze(result);
}

function parseWorldReactionEdges(): readonly WorldReactionEdge[] {
  const root = requireRecord(worldReactionJson, "world reaction manifest");
  if (root.schemaVersion !== "4.0.0-world-reaction-graph") throw new Error("unsupported world reaction schema");
  const sources = new Set(requireStringArray(root.sourceNodes, "world reaction sourceNodes"));
  const reactions = new Set(Object.keys(requireRecord(root.reactionNodes, "world reaction reactionNodes")));
  if (!Array.isArray(root.edges)) throw new Error("world reaction edges must be an array");
  const result = root.edges.map((rawEdge, index) => {
    const edge = requireRecord(rawEdge, `world reaction edges[${index}]`);
    const from = requireString(edge.from, `world reaction edges[${index}].from`);
    const to = requireString(edge.to, `world reaction edges[${index}].to`);
    const event = requireString(edge.event, `world reaction edges[${index}].event`);
    if (!sources.has(from)) throw new Error(`world reaction edge has unknown source: ${from}`);
    if (!reactions.has(to)) throw new Error(`world reaction edge has unknown target: ${to}`);
    return Object.freeze({from, to, event});
  });
  const duplicate = result.find((edge, index) =>
    result.findIndex((other) => other.from === edge.from && other.to === edge.to && other.event === edge.event) !== index,
  );
  if (duplicate !== undefined) throw new Error(`duplicate world reaction edge: ${duplicate.from}/${duplicate.event}`);
  return Object.freeze(result);
}

interface CompiledComparison {
  readonly leftPath: string;
  readonly operator: "==" | "!=" | "<" | "<=" | ">" | ">=";
  readonly right: {readonly kind: "literal"; readonly value: string | number | boolean | null}
    | {readonly kind: "path"; readonly value: string};
}

interface CompiledCondition {
  readonly alternatives: readonly (readonly CompiledComparison[])[];
}

const PATH_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/u;
const COMPARISON_PATTERN = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/u;

function parseOperand(raw: string, path: string): CompiledComparison["right"] {
  const value = raw.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)$/u.test(value)) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${path} has a non-finite literal`);
    return Object.freeze({kind: "literal", value: number});
  }
  const stringMatch = /^'([^']*)'$/u.exec(value);
  if (stringMatch !== null) return Object.freeze({kind: "literal", value: stringMatch[1] ?? ""});
  if (value === "true") return Object.freeze({kind: "literal", value: true});
  if (value === "false") return Object.freeze({kind: "literal", value: false});
  if (value === "null") return Object.freeze({kind: "literal", value: null});
  if (!PATH_PATTERN.test(value)) throw new Error(`${path} has an unsupported operand: ${value}`);
  return Object.freeze({kind: "path", value});
}

function compileCondition(condition: string, path: string): CompiledCondition {
  const alternatives = condition.split(/\s*\|\|\s*/u).map((alternative, alternativeIndex) => {
    if (alternative.length === 0) throw new Error(`${path} has an empty alternative`);
    const comparisons = alternative.split(/\s*&&\s*/u).map((rawComparison, comparisonIndex) => {
      const match = COMPARISON_PATTERN.exec(rawComparison.trim());
      if (match === null) throw new Error(`${path} contains an unsupported expression: ${rawComparison}`);
      const leftPath = match[1]?.trim() ?? "";
      if (!PATH_PATTERN.test(leftPath)) throw new Error(`${path} has an invalid path: ${leftPath}`);
      const operator = match[2] as CompiledComparison["operator"];
      return Object.freeze({
        leftPath,
        operator,
        right: parseOperand(match[3] ?? "", `${path}[${alternativeIndex}][${comparisonIndex}]`),
      });
    });
    return Object.freeze(comparisons);
  });
  return Object.freeze({alternatives: Object.freeze(alternatives)});
}

const INAPPLICABLE = Symbol("inapplicable");

function resolvePath(root: unknown, path: string): unknown | typeof INAPPLICABLE {
  let current = root;
  for (const segment of path.split(".")) {
    if (current === null) return INAPPLICABLE;
    if (Array.isArray(current) && segment === "length") {
      current = current.length;
      continue;
    }
    if (!isRecord(current) || !hasOwn(current, segment)) {
      throw new Error(`validated narrative record is missing observation path: ${path}`);
    }
    current = current[segment];
  }
  return current;
}

function compareValues(left: unknown, operator: CompiledComparison["operator"], right: unknown): boolean {
  if (left === INAPPLICABLE || right === INAPPLICABLE) return false;
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error(`operator ${operator} requires finite numeric operands`);
  }
  switch (operator) {
    case "<": return left < right;
    case "<=": return left <= right;
    case ">": return left > right;
    case ">=": return left >= right;
  }
}

function evaluateCompiledCondition(condition: CompiledCondition, record: NarrativeRecord): boolean {
  return condition.alternatives.some((comparisons) => comparisons.every((comparison) => {
    const left = resolvePath(record, comparison.leftPath);
    const right = comparison.right.kind === "literal"
      ? comparison.right.value
      : resolvePath(record, comparison.right.value);
    return compareValues(left, comparison.operator, right);
  }));
}

function parseObservations(): {
  readonly definitions: readonly AuthoredObservationDefinition[];
  readonly conditions: ReadonlyMap<string, CompiledCondition>;
} {
  const root = requireRecord(snapshotObservationJson, "snapshot observation manifest");
  if (root.schemaVersion !== "4.0.0-snapshot-observations") throw new Error("unsupported snapshot observation schema");
  if (!Array.isArray(root.observations)) throw new Error("snapshot observations must be an array");
  const ids = new Set<string>();
  const conditions = new Map<string, CompiledCondition>();
  const definitions = root.observations.map((rawObservation, index) => {
    const observation = requireRecord(rawObservation, `snapshot observations[${index}]`);
    const id = requireString(observation.id, `snapshot observations[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate snapshot observation id: ${id}`);
    ids.add(id);
    const condition = requireString(observation.condition, `${id}.condition`);
    conditions.set(id, compileCondition(condition, `${id}.condition`));
    const definition = Object.freeze({
      id,
      category: requireString(observation.category, `${id}.category`),
      priority: requireFiniteNumber(observation.priority, `${id}.priority`),
      condition,
      trace: requireStringArray(observation.trace, `${id}.trace`),
      zhCN: requireString(observation["zh-CN"], `${id}.zh-CN`),
      en: requireString(observation.en, `${id}.en`),
    });
    assertObservationalLanguage({zhCN: definition.zhCN, en: definition.en}, `snapshot observation ${id}`);
    return definition;
  });
  return Object.freeze({definitions: Object.freeze(definitions), conditions});
}

function validateNarrativeStateMachine(): void {
  const root = requireRecord(narrativeStateJson, "narrative state manifest");
  if (root.schemaVersion !== "4.0.0-narrative-state-machine") throw new Error("unsupported narrative state schema");
  const states = requireRecord(root.states, "narrative state manifest.states");
  const stateIds = new Set(Object.keys(states));
  const initial = requireString(root.initialState, "narrative initialState");
  const terminal = requireString(root.terminalState, "narrative terminalState");
  if (!stateIds.has(initial) || !stateIds.has(terminal)) throw new Error("narrative initial/terminal state is unknown");
  for (const [stateId, rawState] of Object.entries(states)) {
    const state = requireRecord(rawState, `narrative state ${stateId}`);
    if (state.next !== undefined && !stateIds.has(requireString(state.next, `${stateId}.next`))) {
      throw new Error(`narrative state ${stateId} has an unknown next state`);
    }
    if (state.transitions !== undefined) {
      if (!Array.isArray(state.transitions)) throw new Error(`${stateId}.transitions must be an array`);
      for (const rawTransition of state.transitions) {
        const transition = requireRecord(rawTransition, `${stateId}.transition`);
        if (!stateIds.has(requireString(transition.next, `${stateId}.transition.next`))) {
          throw new Error(`narrative state ${stateId} has an unknown transition target`);
        }
      }
    }
  }
  const reachable = new Set<string>([initial]);
  const queue = [initial];
  while (queue.length > 0) {
    const stateId = queue.shift() as string;
    const state = requireRecord(states[stateId], `narrative state ${stateId}`);
    const targets = [
      ...(typeof state.next === "string" ? [state.next] : []),
      ...(Array.isArray(state.transitions)
        ? state.transitions.map((raw) => requireString(requireRecord(raw, `${stateId}.transition`).next, `${stateId}.transition.next`))
        : []),
    ];
    for (const target of targets) {
      if (!reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }
  if (reachable.size !== stateIds.size) throw new Error("narrative state graph contains an unreachable state");
}

function validateRuntimeReferences(): void {
  const schema = requireRecord(eventSchemaJson, "runtime event schema");
  if (schema.schemaVersion !== "4.0.0") throw new Error("unsupported runtime event schema");
  if (!Array.isArray(schema.events)) throw new Error("runtime event schema events must be an array");
  const ids = schema.events.map((raw, index) =>
    requireString(requireRecord(raw, `runtime events[${index}]`).id, `runtime events[${index}].id`));
  if (new Set(ids).size !== ids.length) throw new Error("runtime event schema contains duplicate event ids");
  if (ids.length !== CANONICAL_EVENT_IDS.length || ids.some((id) => !CANONICAL_EVENT_IDS.includes(id as never))) {
    throw new Error("narrative authority and canonical event registry disagree");
  }
  const runtime = requireRecord(runtimeStateMachineJson, "runtime state machine manifest");
  if (runtime.schemaVersion !== "4.0.0") throw new Error("unsupported runtime state machine schema");
  if (!Array.isArray(runtime.machines)) throw new Error("runtime state machines must be an array");
  const known = new Set(ids);
  for (const [machineIndex, rawMachine] of runtime.machines.entries()) {
    const machine = requireRecord(rawMachine, `runtime machines[${machineIndex}]`);
    if (!Array.isArray(machine.transitions)) throw new Error(`runtime machine ${String(machine.id)} has no transitions`);
    for (const [transitionIndex, rawTransition] of machine.transitions.entries()) {
      const transition = requireRecord(rawTransition, `runtime machine transition ${transitionIndex}`);
      for (const event of requireStringArray(transition.events, `runtime machine transition ${transitionIndex}.events`)) {
        if (!known.has(event)) throw new Error(`runtime state machine references unknown canonical event: ${event}`);
      }
    }
  }
}

function validatePresentationManifests(): void {
  const weather = requireRecord(weatherSystemJson, "weather manifest");
  if (weather.schemaVersion !== "4.0.0-weather" || weather.authority !== "world-presentation") {
    throw new Error("unsupported weather presentation manifest");
  }
  const weatherDefinitions = requireRecord(weather.weather, "weather manifest.weather");
  const weatherIds = Object.keys(weatherDefinitions);
  if (weatherIds.length !== NARRATIVE_WEATHER_IDS.length
    || weatherIds.some((id) => !NARRATIVE_WEATHER_IDS.includes(id as NarrativeWeatherId))) {
    throw new Error("weather presentation manifest contains an unknown weather type");
  }
  const witnesses = requireRecord(witnessConditionJson, "witness condition manifest");
  if (witnesses.schemaVersion !== "4.0.0-witness-conditions" || !Array.isArray(witnesses.states)) {
    throw new Error("unsupported witness condition manifest");
  }
  const witnessIds = witnesses.states.map((raw, index) =>
    requireString(requireRecord(raw, `witness states[${index}]`).id, `witness states[${index}].id`));
  if (new Set(witnessIds).size !== witnessIds.length) throw new Error("duplicate witness state id");
}

validateNarrativeStateMachine();
validateRuntimeReferences();
validatePresentationManifests();

export const AUTHORED_ROOM_THRESHOLDS = parseRoomThresholds();
export const AUTHORED_BOSS_RESOLUTIONS = parseBossResolutions();
export const AUTHORED_WORLD_REACTION_EDGES = parseWorldReactionEdges();
const PARSED_OBSERVATIONS = parseObservations();
export const AUTHORED_SNAPSHOT_OBSERVATIONS = PARSED_OBSERVATIONS.definitions;

const BOSS_BY_ID = new Map(AUTHORED_BOSS_RESOLUTIONS.map((definition) => [definition.bossId, definition]));
const OBSERVATION_BY_ID = new Map(AUTHORED_SNAPSHOT_OBSERVATIONS.map((definition) => [definition.id, definition]));
const WORLD_EDGES_BY_SOURCE = new Map<string, readonly WorldReactionEdge[]>();
for (const source of requireStringArray(
  requireRecord(worldReactionJson, "world reaction manifest").sourceNodes,
  "world reaction sourceNodes",
)) {
  WORLD_EDGES_BY_SOURCE.set(
    source,
    Object.freeze(AUTHORED_WORLD_REACTION_EDGES.filter((edge) => edge.from === source)),
  );
}

function findRoomActionGaps(): readonly string[] {
  const reactionNodes = requireRecord(
    requireRecord(worldReactionJson, "world reaction manifest").reactionNodes,
    "world reaction reactionNodes",
  );
  return Object.freeze(AUTHORED_ROOM_THRESHOLDS.flatMap((threshold) => {
    const separator = threshold.reaction.indexOf(".");
    const nodeId = separator < 0 ? threshold.reaction : threshold.reaction.slice(0, separator);
    const action = separator < 0 ? "" : threshold.reaction.slice(separator + 1);
    const node = reactionNodes[nodeId];
    if (!isRecord(node)) return [threshold.reaction];
    const authoredActions = [
      ...(Array.isArray(node.digital) ? node.digital : []),
      ...(Array.isArray(node.material) ? node.material : []),
    ];
    return authoredActions.includes(action) ? [] : [threshold.reaction];
  }));
}

const runtimeWeatherMachine = (runtimeStateMachineJson.machines as readonly Dictionary[])
  .find((machine) => machine.id === "weather");
const runtimeWeatherTypes = runtimeWeatherMachine === undefined
  ? []
  : requireStringArray(runtimeWeatherMachine.weatherTypes, "runtime weather types");
const unboundWeatherTypes = runtimeWeatherTypes.filter(
  (weather) => !NARRATIVE_WEATHER_IDS.includes(weather as NarrativeWeatherId),
);
const sourcesWithoutEdges = Array.from(WORLD_EDGES_BY_SOURCE.entries())
  .filter(([, edges]) => edges.length === 0)
  .map(([source]) => source);
const roomActionGaps = findRoomActionGaps();

const MANIFEST_GAPS = Object.freeze([
  ...(unboundWeatherTypes.length === 0
    ? []
    : [`runtime weather types without narrative weather definitions: ${unboundWeatherTypes.join(", ")}`]),
  ...(sourcesWithoutEdges.length === 0
    ? []
    : [`world reaction sources without authored edges: ${sourcesWithoutEdges.join(", ")}`]),
  ...(roomActionGaps.length === 0
    ? []
    : [`room threshold reactions without matching reaction-node actions: ${roomActionGaps.join(", ")}`]),
  "room threshold metrics have no canonical threshold-crossing event payload; this reducer catalogs them but does not infer crossings",
]);

export const NARRATIVE_AUTHORITY_REPORT: NarrativeAuthorityReport = Object.freeze({
  narrativeStates: NARRATIVE_STATE_IDS.length,
  roomThresholds: AUTHORED_ROOM_THRESHOLDS.length,
  bossResolutions: AUTHORED_BOSS_RESOLUTIONS.length,
  snapshotObservations: AUTHORED_SNAPSHOT_OBSERVATIONS.length,
  weatherTypes: NARRATIVE_WEATHER_IDS.length,
  worldReactionEdges: AUTHORED_WORLD_REACTION_EDGES.length,
  witnessStates: witnessConditionJson.states.length,
  canonicalEvents: CANONICAL_EVENT_IDS.length,
  runtimeMachines: runtimeStateMachineJson.machines.length,
  compiledObservationConditions: PARSED_OBSERVATIONS.conditions.size,
  manifestGaps: MANIFEST_GAPS,
});

const VALIDATED_RECORDS = new WeakSet<object>();

function assertNarrativeRecordBoundary(value: unknown): asserts value is NarrativeRecord {
  const record = requireRecord(value, "validated narrative record");
  const run = requireRecord(record.run, "validated narrative record.run");
  requireString(run.id, "validated narrative record.run.id");
  requireNonNegativeInteger(run.seed, "validated narrative record.run.seed");
  const fingerprint = requireRecord(record.fingerprint, "validated narrative record.fingerprint");
  requireString(fingerprint.digestSha256, "validated narrative record.fingerprint.digestSha256");
  const material = requireRecord(record.materialMemory, "validated narrative record.materialMemory");
  for (const key of ["overrideScars", "deathTraces", "burnIns", "ghostResidues"] as const) {
    if (!Array.isArray(material[key])) throw new Error(`validated narrative record.materialMemory.${key} must be an array`);
  }
  if (record.ghostRoute !== null) {
    const route = requireRecord(record.ghostRoute, "validated narrative record.ghostRoute");
    requireString(route.routeDigest, "validated narrative record.ghostRoute.routeDigest");
    if (!Array.isArray(route.points) || route.points.length < 2) {
      throw new Error("validated narrative record.ghostRoute.points must contain an actual route");
    }
    for (const [index, rawPoint] of route.points.entries()) {
      requireNonNegativeInteger(
        requireRecord(rawPoint, `validated narrative record.ghostRoute.points[${index}]`).tMs,
        `validated narrative record.ghostRoute.points[${index}].tMs`,
      );
    }
  }
}

/** Opaque, immutable proof that an application-owned V4 validator accepted the record. */
export class ValidatedNarrativeRecord {
  readonly #record: Readonly<NarrativeRecord>;

  private constructor(record: Readonly<NarrativeRecord>) {
    this.#record = record;
    VALIDATED_RECORDS.add(this);
    Object.freeze(this);
  }

  static create(value: unknown, validator: NarrativeRecordValidator): ValidatedNarrativeRecord {
    if (typeof validator !== "function") throw new Error("narrative record validator must be injected");
    const cloned = cloneJson(value);
    validator(cloned);
    assertNarrativeRecordBoundary(cloned);
    return new ValidatedNarrativeRecord(deepFreeze(cloned));
  }

  read(): Readonly<NarrativeRecord> {
    if (!VALIDATED_RECORDS.has(this)) throw new Error("unvalidated narrative record token");
    return this.#record;
  }
}

export function validateNarrativeRecord(
  value: unknown,
  validator: NarrativeRecordValidator,
): ValidatedNarrativeRecord {
  return ValidatedNarrativeRecord.create(value, validator);
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function traceValue(value: unknown): JsonValue {
  if (Array.isArray(value)) return Object.freeze({length: value.length});
  return canonicalize(value, "observation trace");
}

export function evaluateObservationCondition(
  observationId: string,
  recordToken: ValidatedNarrativeRecord,
): boolean {
  const definition = OBSERVATION_BY_ID.get(observationId);
  const condition = PARSED_OBSERVATIONS.conditions.get(observationId);
  if (definition === undefined || condition === undefined) {
    throw new Error(`unknown authored snapshot observation: ${observationId}`);
  }
  return evaluateCompiledCondition(condition, recordToken.read() as NarrativeRecord);
}

export function selectSnapshotObservations(
  recordToken: ValidatedNarrativeRecord,
): readonly SelectedObservation[] {
  const record = recordToken.read() as NarrativeRecord;
  const eligible = AUTHORED_SNAPSHOT_OBSERVATIONS
    .filter((definition) => {
      const condition = PARSED_OBSERVATIONS.conditions.get(definition.id);
      if (condition === undefined) throw new Error(`observation condition was not compiled: ${definition.id}`);
      return evaluateCompiledCondition(condition, record);
    })
    .sort((left, right) =>
      right.priority - left.priority
      || hashString(`${record.run.id}\u0000${left.id}`) - hashString(`${record.run.id}\u0000${right.id}`)
      || compareCodePoint(left.id, right.id),
    );
  const categories = new Set<string>();
  const selected: SelectedObservation[] = [];
  for (const definition of eligible) {
    if (categories.has(definition.category)) continue;
    categories.add(definition.category);
    selected.push(Object.freeze({
      id: definition.id,
      category: definition.category,
      zhCN: definition.zhCN,
      en: definition.en,
      trace: Object.freeze(definition.trace.map((path) => {
        const value = resolvePath(record, path);
        if (value === INAPPLICABLE) throw new Error(`selected observation has an inapplicable trace path: ${path}`);
        return Object.freeze({path, value: traceValue(value)});
      })),
    }));
    if (selected.length === 3) break;
  }
  assertObservationalLanguage(selected, "selected snapshot observations");
  return Object.freeze(selected);
}

function payloadString(payload: JsonObject, key: string, eventId: string): string {
  return requireString(payload[key], `${eventId}.payload.${key}`);
}

function payloadInteger(payload: JsonObject, key: string, eventId: string): number {
  return requireNonNegativeInteger(payload[key], `${eventId}.payload.${key}`);
}

function payloadRoom(payload: JsonObject, key: string, eventId: string): NarrativeRoomId {
  const room = payloadString(payload, key, eventId);
  if (!NARRATIVE_ROOM_IDS.includes(room as NarrativeRoomId)) {
    throw new Error(`${eventId} references unknown narrative room: ${room}`);
  }
  return room as NarrativeRoomId;
}

function payloadWeather(payload: JsonObject, eventId: string): NarrativeWeatherId {
  const weather = payloadString(payload, "weather", eventId);
  if (!NARRATIVE_WEATHER_IDS.includes(weather as NarrativeWeatherId)) {
    throw new Error(`${eventId} references unknown narrative weather: ${weather}`);
  }
  return weather as NarrativeWeatherId;
}

function eventSources(event: CanonicalGameplayEvent): readonly string[] {
  const id = event.id as string;
  const sources: string[] = [];
  if (id === "flower.intensity.commit") {
    const source = payloadString(event.payload, "source", id).toUpperCase();
    const mapped = source === "FOCUS"
      ? "player.focus"
      : source === "GAZE"
        ? "player.gaze"
        : source === "OVERRIDE"
          ? "player.override"
          : source === "SIGNAL"
            ? "player.signal"
            : null;
    if (mapped === null) throw new Error(`flower.intensity.commit has unknown source: ${source}`);
    sources.push(mapped);
  }
  if (id.startsWith("gaze.")) sources.push("player.gaze");
  if (id === "projectile.graze.commit" || id.startsWith("evidence.")) sources.push("player.graze");
  if (id.startsWith("player.override.") || id === "cross_run.scar.write.commit") sources.push("player.override");
  if (id.startsWith("room.transition.") || id.startsWith("snapshot.")) sources.push("player.route");
  if (id === "room.transition.world_swap.commit" || id === "room.transition.room_ready") {
    sources.push("room.threshold");
  }
  if (id.startsWith("weather.")) sources.push("weather.lifecycle");
  if (id.startsWith("cross_run.") || id.endsWith(".rehydrate") || id.startsWith("ghost.")
    || id === "witness.turn" || id === "returnInput") {
    sources.push("run.memory");
  }
  return Object.freeze(Array.from(new Set(sources)));
}

function stateDefinition(stateId: NarrativeStateId): Dictionary {
  const states = requireRecord(
    requireRecord(narrativeStateJson, "narrative state manifest").states,
    "narrative state manifest.states",
  );
  return requireRecord(states[stateId], `narrative state ${stateId}`);
}

function transitionCues(from: NarrativeStateId, to: NarrativeStateId): readonly string[] {
  const source = stateDefinition(from);
  const target = stateDefinition(to);
  const exitEvents = source.exitEvents === undefined ? [] : requireStringArray(source.exitEvents, `${from}.exitEvents`);
  const enterEvents = target.enterEvents === undefined ? [] : requireStringArray(target.enterEvents, `${to}.enterEvents`);
  const edgeEvents = Array.isArray(source.transitions)
    ? source.transitions.flatMap((raw) => {
      const transition = requireRecord(raw, `${from}.transition`);
      if (transition.next !== to || transition.events === undefined) return [];
      return [...requireStringArray(transition.events, `${from}->${to}.events`)];
    })
    : [];
  return Object.freeze([...exitEvents, ...edgeEvents, ...enterEvents]);
}

function isAuthoredState(value: string): value is NarrativeStateId {
  return NARRATIVE_STATE_IDS.includes(value);
}

function authoredTargets(stateId: NarrativeStateId): readonly NarrativeStateId[] {
  const state = stateDefinition(stateId);
  const targets = [
    ...(typeof state.next === "string" ? [state.next] : []),
    ...(Array.isArray(state.transitions)
      ? state.transitions.map((raw) => requireString(requireRecord(raw, `${stateId}.transition`).next, `${stateId}.transition.next`))
      : []),
  ];
  return Object.freeze(targets.filter(isAuthoredState));
}

function compareEvents(left: CanonicalGameplayEvent, right: CanonicalGameplayEvent): number {
  return left.tick120 - right.tick120
    || left.phasePriority - right.phasePriority
    || compareCodePoint(left.entityStableId, right.entityStableId)
    || left.localSequence - right.localSequence
    || left.sequence - right.sequence;
}

function canonicalEventFingerprint(event: CanonicalGameplayEvent): string {
  return JSON.stringify(canonicalize(event, "canonical event"));
}

const WEATHER_EVENT_PHASE: Readonly<Record<string, NarrativeWeatherPhase>> = Object.freeze({
  "weather.omen.begin": "OMEN",
  "weather.active.begin": "BURST",
  "weather.aftermath.begin": "AFTERMATH",
  "weather.cooldown.begin": "COOLDOWN",
  "weather.complete": "COMPLETE",
});

const WEATHER_PHASE_ORDER: Readonly<Record<NarrativeWeatherPhase, number>> = Object.freeze({
  OMEN: 0,
  BURST: 1,
  AFTERMATH: 2,
  COOLDOWN: 3,
  COMPLETE: 4,
});

const RESTORE_STAGE: Readonly<Record<string, number>> = Object.freeze({
  "overrideScar.rehydrate": 0,
  "deathTrace.rehydrate": 1,
  "burnIn.rehydrate": 2,
  "ghost.replay.begin": 3,
  "ghost.replay.complete": 3,
  "ghost.residue.write": 4,
  "witness.turn": 5,
  returnInput: 6,
  "cross_run.restore.complete": 7,
});

const MATERIAL_EVENT_KEY: Readonly<Record<string, keyof NarrativeRecord["materialMemory"]>> = Object.freeze({
  "overrideScar.rehydrate": "overrideScars",
  "deathTrace.rehydrate": "deathTraces",
  "burnIn.rehydrate": "burnIns",
});

export interface NarrativeAuthorityOptions {
  readonly previousRun?: ValidatedNarrativeRecord;
  readonly snapshotRecord?: ValidatedNarrativeRecord;
}

/**
 * A deterministic one-way reducer. It consumes committed gameplay facts and
 * only exposes frozen narrative/presentation projections; it owns no gameplay
 * command port.
 */
export class NarrativeAuthority {
  private readonly previousRun: ValidatedNarrativeRecord | null;
  private readonly snapshotRecord: ValidatedNarrativeRecord | null;
  private readonly occurrenceFingerprints = new Map<string, string>();
  private readonly visited = new Set<NarrativeRoomId>();
  private readonly bossResolutionList: BossResolutionProjection[] = [];
  private readonly reactionList: WorldReactionProjection[] = [];
  private readonly transitionList: NarrativeTransitionProjection[] = [];
  private readonly crossRunList: CrossRunProjection[] = [];
  private selectedObservations: readonly SelectedObservation[] = Object.freeze([]);
  private currentState: NarrativeStateId = narrativeStateJson.initialState;
  private room: NarrativeRoomId | null = null;
  private weatherProjection: WeatherProjection | null = null;
  private lastWeatherOrder = -1;
  private lastEvent: CanonicalGameplayEvent | null = null;
  private projectionOrder = 0;
  private restoreStage = -1;
  private restoreFromRunId: string | null = null;
  private restoreNextRunId: string | null = null;
  private snapshotComplete = false;
  private persisted = false;
  private handoff = false;

  constructor(options: NarrativeAuthorityOptions = {}) {
    this.previousRun = options.previousRun ?? null;
    this.snapshotRecord = options.snapshotRecord ?? null;
    this.previousRun?.read();
    this.snapshotRecord?.read();
  }

  consume(event: CanonicalGameplayEvent): void {
    assertCanonicalEventEnvelope(event);
    const fingerprint = canonicalEventFingerprint(event);
    const priorFingerprint = this.occurrenceFingerprints.get(event.occurrenceKey);
    if (priorFingerprint !== undefined) {
      if (priorFingerprint !== fingerprint) {
        throw new Error(`conflicting duplicate narrative occurrence: ${event.occurrenceKey}`);
      }
      return;
    }
    if (this.lastEvent !== null && compareEvents(this.lastEvent, event) > 0) {
      throw new Error(`narrative event order regressed at occurrence: ${event.occurrenceKey}`);
    }
    this.validateCanonicalReferences(event);
    this.consumeWeather(event);
    this.consumeRoom(event);
    this.consumeBoss(event);
    this.consumeCrossRun(event);
    this.projectWorldReactions(event);
    this.advanceNarrativeState(event);
    this.consumeSnapshot(event);
    this.occurrenceFingerprints.set(event.occurrenceKey, fingerprint);
    this.lastEvent = event;
  }

  consumeMany(events: readonly CanonicalGameplayEvent[]): void {
    for (const event of events) this.consume(event);
  }

  snapshot(): NarrativeSnapshot {
    const snapshot: NarrativeSnapshot = {
      authority: "narrative-projection",
      state: this.currentState,
      activeRoom: this.room,
      visitedRooms: Object.freeze(NARRATIVE_ROOM_IDS.filter((room) => this.visited.has(room))),
      weather: this.weatherProjection === null ? null : frozenClone(this.weatherProjection),
      bossResolutions: frozenClone(this.bossResolutionList),
      reactions: frozenClone(this.reactionList),
      transitions: frozenClone(this.transitionList),
      crossRun: frozenClone(this.crossRunList),
      observations: frozenClone(this.selectedObservations),
      handoffReady: this.handoff,
      processedOccurrences: this.occurrenceFingerprints.size,
      lastTick120: this.lastEvent?.tick120 ?? null,
    };
    assertObservationalLanguage(snapshot, "narrative snapshot");
    return deepFreeze(snapshot) as NarrativeSnapshot;
  }

  canonicalSerialization(): string {
    return serializeNarrativeSnapshot(this.snapshot());
  }

  private validateCanonicalReferences(event: CanonicalGameplayEvent): void {
    const id = event.id as string;
    if (id.startsWith("room.transition.")) {
      if (id === "room.transition.begin" || id === "room.transition.world_swap.commit") {
        payloadRoom(event.payload, "fromRoom", id);
        payloadRoom(event.payload, "toRoom", id);
      } else {
        payloadRoom(event.payload, "room", id);
      }
    }
    if (id === "player.override.charge.begin" || id === "player.override.commit"
      || id === "cross_run.scar.write.commit") {
      payloadRoom(event.payload, "roomId", id);
    }
    if (id === "boss.encounter.begin" || id.startsWith("boss.phase.") || id === "boss.encounter.resolve") {
      const bossId = payloadString(event.payload, "bossId", id);
      if (!BOSS_BY_ID.has(bossId)) throw new Error(`${id} references unknown authored boss: ${bossId}`);
    }
  }

  private consumeWeather(event: CanonicalGameplayEvent): void {
    const id = event.id as string;
    const phase = WEATHER_EVENT_PHASE[id];
    if (phase === undefined) return;
    const weather = payloadWeather(event.payload, id);
    const cycle = payloadInteger(event.payload, "cycle", id);
    const order = WEATHER_PHASE_ORDER[phase];
    if (phase === "OMEN") {
      if (this.weatherProjection !== null && this.weatherProjection.phase !== "COMPLETE") {
        throw new Error("weather omen began before the preceding presentation lifecycle completed");
      }
      this.lastWeatherOrder = -1;
    } else {
      if (this.weatherProjection === null
        || this.weatherProjection.weather !== weather
        || this.weatherProjection.cycle !== cycle) {
        throw new Error(`${id} does not match the active presentation weather cycle`);
      }
      if (order !== this.lastWeatherOrder + 1) throw new Error(`${id} skipped a presentation weather phase`);
    }
    this.lastWeatherOrder = order;
    this.weatherProjection = Object.freeze({
      weather,
      cycle,
      phase,
      tick120: event.tick120,
      occurrenceKey: event.occurrenceKey,
    });
  }

  private consumeRoom(event: CanonicalGameplayEvent): void {
    if (event.id !== "room.transition.world_swap.commit") return;
    const destination = payloadRoom(event.payload, "toRoom", event.id);
    this.room = destination;
    this.visited.add(destination);
  }

  private consumeBoss(event: CanonicalGameplayEvent): void {
    if (event.id !== "boss.encounter.resolve") return;
    const bossId = payloadString(event.payload, "bossId", event.id);
    const outcome = payloadString(event.payload, "outcome", event.id);
    const definition = BOSS_BY_ID.get(bossId);
    if (definition === undefined) throw new Error(`boss resolution references unknown boss: ${bossId}`);
    if (outcome !== definition.resolutionId) {
      throw new Error(`boss ${bossId} emitted an unauthored factual resolution: ${outcome}`);
    }
    this.bossResolutionList.push(Object.freeze({
      ...definition,
      tick120: event.tick120,
      occurrenceKey: event.occurrenceKey,
      order: this.nextProjectionOrder(),
    }));
  }

  private consumeCrossRun(event: CanonicalGameplayEvent): void {
    const id = event.id as string;
    if (id === "cross_run.record.persist.commit") {
      this.validateSnapshotRecordPayload(event);
      this.persisted = true;
      return;
    }
    if (id === "cross_run.restore.begin") {
      const record = this.requirePreviousRun(id);
      const fromRunId = payloadString(event.payload, "fromRunId", id);
      if (fromRunId !== record.run.id) throw new Error(`${id} fromRunId does not match the validated record`);
      this.validateRoutePayload(event.payload, record, id);
      this.restoreFromRunId = fromRunId;
      this.restoreNextRunId = payloadString(event.payload, "nextRunId", id);
      this.restoreStage = -1;
      this.appendCrossRunProjection(event, record, null);
      return;
    }
    const stage = RESTORE_STAGE[id];
    if (stage === undefined) return;
    const record = this.requirePreviousRun(id);
    if (this.restoreFromRunId === null || this.restoreNextRunId === null) {
      throw new Error(`${id} arrived before cross_run.restore.begin`);
    }
    if (stage < this.restoreStage || stage > this.restoreStage + 1) {
      throw new Error(`${id} violates validated cross-run rehydration order`);
    }
    const fromRunId = payloadString(event.payload, "fromRunId", id);
    const nextRunId = payloadString(event.payload, "nextRunId", id);
    if (fromRunId !== this.restoreFromRunId || nextRunId !== this.restoreNextRunId) {
      throw new Error(`${id} changed the validated restore identity`);
    }
    const materialKey = MATERIAL_EVENT_KEY[id];
    let count: number | null = null;
    if (materialKey !== undefined) {
      count = record.materialMemory[materialKey].length;
      if (payloadInteger(event.payload, "count", id) !== count) {
        throw new Error(`${id} count does not match the validated record`);
      }
    }
    if (id === "ghost.replay.begin" || id === "ghost.replay.complete"
      || id === "cross_run.restore.complete") {
      this.validateRoutePayload(event.payload, record, id);
    }
    if (id === "returnInput") {
      const expectedDuration = record.ghostRoute?.points.at(-1)?.tMs ?? 0;
      if (payloadInteger(event.payload, "routeDurationMs", id) !== expectedDuration) {
        throw new Error("returnInput routeDurationMs does not match the validated record");
      }
    }
    if (id === "ghost.replay.begin") {
      if (record.ghostRoute === null) throw new Error("ghost replay cannot read a validated record without a route");
      if (payloadInteger(event.payload, "pointCount", id) !== record.ghostRoute.points.length) {
        throw new Error("ghost replay point count does not match the validated record");
      }
      if (event.payload.collisionClass !== "NONE" || event.payload.rewardClass !== "NONE") {
        throw new Error("ghost replay must remain non-colliding and non-rewarding");
      }
    }
    if (id === "ghost.residue.write") {
      const routeDigest = record.ghostRoute?.routeDigest ?? null;
      if (payloadString(event.payload, "sourceRouteDigest", id) !== routeDigest) {
        throw new Error("ghost residue source does not match the validated route");
      }
      if (event.payload.createdAfterReplay !== true) throw new Error("ghost residue must follow replay");
    }
    this.restoreStage = Math.max(this.restoreStage, stage);
    this.appendCrossRunProjection(event, record, count);
  }

  private appendCrossRunProjection(
    event: CanonicalGameplayEvent,
    record: Readonly<NarrativeRecord>,
    count: number | null,
  ): void {
    this.crossRunList.push(Object.freeze({
      eventId: event.id,
      fromRunId: record.run.id,
      nextRunId: typeof event.payload.nextRunId === "string" ? event.payload.nextRunId : null,
      recordCount: count,
      routeDigest: record.ghostRoute?.routeDigest ?? null,
      tick120: event.tick120,
      occurrenceKey: event.occurrenceKey,
      order: this.nextProjectionOrder(),
    }));
  }

  private validateRoutePayload(
    payload: JsonObject,
    record: Readonly<NarrativeRecord>,
    eventId: string,
  ): void {
    const route = record.ghostRoute;
    const expectedDigest = route?.routeDigest ?? null;
    const actualDigest = payload.routeDigest;
    if (actualDigest !== expectedDigest) throw new Error(`${eventId} routeDigest does not match the validated record`);
    const expectedDuration = route?.points.at(-1)?.tMs ?? 0;
    if (payloadInteger(payload, "routeDurationMs", eventId) !== expectedDuration) {
      throw new Error(`${eventId} routeDurationMs does not match the validated record`);
    }
  }

  private validateSnapshotRecordPayload(event: CanonicalGameplayEvent): Readonly<NarrativeRecord> {
    if (this.snapshotRecord === null) throw new Error(`${event.id} requires a validated current-run record`);
    const record = this.snapshotRecord.read();
    const id = event.id as string;
    if (payloadString(event.payload, "runId", id) !== record.run.id) {
      throw new Error(`${id} runId does not match the validated record`);
    }
    if (event.payload.deterministicSeed !== record.run.seed) {
      throw new Error(`${id} deterministicSeed does not match the validated record`);
    }
    this.validateRoutePayload(event.payload, record, id);
    return record;
  }

  private requirePreviousRun(eventId: string): Readonly<NarrativeRecord> {
    if (this.previousRun === null) throw new Error(`${eventId} requires a validated previous-run record`);
    return this.previousRun.read();
  }

  private projectWorldReactions(event: CanonicalGameplayEvent): void {
    for (const source of eventSources(event)) {
      const edges = WORLD_EDGES_BY_SOURCE.get(source);
      if (edges === undefined) throw new Error(`canonical event mapped to unknown world reaction source: ${source}`);
      for (const edge of edges) {
        this.reactionList.push(Object.freeze({
          ...edge,
          sourceOccurrenceKey: event.occurrenceKey,
          tick120: event.tick120,
          order: this.nextProjectionOrder(),
        }));
      }
    }
  }

  private advanceNarrativeState(event: CanonicalGameplayEvent): void {
    const id = event.id as string;
    switch (id) {
      case "ghost.replay.begin":
        this.transitionTo("GHOST_REPLAY", event);
        break;
      case "ghost.replay.complete":
        this.transitionTo("WITNESS_ORIENTATION", event);
        break;
      case "returnInput":
        this.transitionTo("AWAKENING", event);
        break;
      case "gaze.acquire.begin":
        if (this.currentState === "AWAKENING") this.transitionTo("FIRST_EYE", event);
        break;
      case "gaze.clamp.commit":
        if (this.currentState === "FIRST_EYE") this.transitionTo("FIRST_CLAMP_RECOVERY", event);
        break;
      case "gaze.clamp.release":
        if (this.currentState === "FIRST_CLAMP_RECOVERY") this.transitionTo("ROOM_SAMPLING", event);
        break;
      case "room.transition.world_swap.commit":
        if (this.currentState === "FIRST_CLAMP_RECOVERY") this.transitionTo("ROOM_SAMPLING", event);
        if (this.currentState === "ROOM_SAMPLING" && this.visited.size >= 2) {
          this.transitionTo("WORLD_RESPONSE", event);
        }
        break;
      case "player.override.ready":
      case "player.override.charge.begin":
        if (this.currentState === "WORLD_RESPONSE") this.transitionTo("LOCAL_RESISTANCE_AVAILABLE", event);
        break;
      case "player.override.local_void.open":
        if (this.currentState === "LOCAL_RESISTANCE_AVAILABLE") {
          this.transitionTo("LOCAL_RESISTANCE_DECAY", event);
        }
        break;
      case "player.override.local_void.close":
        if (this.currentState === "LOCAL_RESISTANCE_DECAY") this.transitionTo("WORLD_RESPONSE", event);
        break;
      case "run.end.commit":
        if (this.currentState === "WORLD_RESPONSE" || this.currentState === "LOCAL_RESISTANCE_AVAILABLE") {
          this.transitionTo("DUSK_APPROACH", event);
          this.transitionTo(this.room === "POLARIZED" ? "NO_DUSK" : "RUN_END_COMMIT", event);
        }
        break;
      case "boss.encounter.resolve":
        if (this.currentState === "NO_DUSK" && event.payload.outcome === "NO_DUSK_WITHDRAWAL") {
          this.transitionTo("RUN_END_COMMIT", event);
        }
        break;
      case "snapshot.begin":
        if (this.currentState === "NO_DUSK") this.transitionTo("RUN_END_COMMIT", event);
        if (this.currentState === "RUN_END_COMMIT") this.transitionTo("STATE_SNAPSHOT", event);
        break;
      case "cross_run.record.persist.commit":
        if (this.currentState === "STATE_SNAPSHOT") this.transitionTo("CROSS_RUN_MATERIALIZATION", event);
        break;
      case "snapshot.complete":
        if (this.currentState === "CROSS_RUN_MATERIALIZATION" && this.persisted) {
          this.transitionTo("RUN_CYCLE_COMPLETE", event);
        }
        break;
    }
  }

  private transitionTo(target: NarrativeStateId, event: CanonicalGameplayEvent): void {
    if (target === this.currentState) return;
    const targets = authoredTargets(this.currentState);
    if (!targets.includes(target)) {
      throw new Error(`unauthored narrative transition: ${this.currentState} -> ${target}`);
    }
    const from = this.currentState;
    this.currentState = target;
    this.transitionList.push(Object.freeze({
      from,
      to: target,
      tick120: event.tick120,
      occurrenceKey: event.occurrenceKey,
      order: this.nextProjectionOrder(),
      cues: transitionCues(from, target),
    }));
  }

  private consumeSnapshot(event: CanonicalGameplayEvent): void {
    if (event.id === "snapshot.serialize.commit") {
      const record = this.validateSnapshotRecordPayload(event);
      this.selectedObservations = selectSnapshotObservations(this.snapshotRecord as ValidatedNarrativeRecord);
      if (payloadString(event.payload, "snapshotHash", event.id) !== record.fingerprint.digestSha256) {
        throw new Error("snapshotHash does not match the validated current-run fingerprint");
      }
    }
    if (event.id === "snapshot.complete") {
      if (this.snapshotRecord !== null
        && payloadString(event.payload, "runId", event.id) !== this.snapshotRecord.read().run.id) {
        throw new Error("snapshot.complete runId does not match the validated current-run record");
      }
      this.snapshotComplete = true;
      this.handoff = this.selectedObservations.length > 0;
      if (this.currentState === "CROSS_RUN_MATERIALIZATION" && this.persisted) {
        this.handoff = true;
      }
    }
    if (this.snapshotComplete && this.persisted) this.handoff = true;
  }

  private nextProjectionOrder(): number {
    const order = this.projectionOrder;
    this.projectionOrder += 1;
    return order;
  }
}
