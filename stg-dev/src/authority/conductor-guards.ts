/**
 * Fail-closed loader for narrative-state-machine-v4.json plus the small guard
 * expression compiler the run conductor drives it with.
 *
 * The manifest's 16 states are literal runtime data: every guard string is
 * compiled at construction into comparisons over named facts, and every fact
 * name must resolve against the caller-supplied registry of known fact names.
 * An unknown fact, state, policy, or malformed guard is a construction error,
 * never a silent `false`.
 *
 * Grammar (exactly what the V4 manifest uses — anything else is rejected):
 *   guard      := andChain ("||" andChain)*
 *   andChain   := comparison ("&&" comparison)*
 *   comparison := operand op operand
 *   op         := "==" | "!=" | ">=" | "<=" | ">" | "<"
 *   operand    := factPath | number | 'string' | true | false | null
 */

export type GuardFactValue = number | string | boolean | null;

export type GuardComparisonOperator = "==" | "!=" | ">=" | "<=" | ">" | "<";

export interface GuardOperand {
  readonly kind: "fact" | "literal";
  /** Fact path for kind "fact"; ignored for literals. */
  readonly factName: string;
  /** Literal value for kind "literal"; ignored for facts. */
  readonly literal: GuardFactValue;
}

export interface GuardComparison {
  readonly left: GuardOperand;
  readonly operator: GuardComparisonOperator;
  readonly right: GuardOperand;
}

export interface CompiledGuard {
  readonly source: string;
  /** Disjunction of conjunctions, exactly mirroring the authored `||`/`&&`. */
  readonly disjunction: readonly (readonly GuardComparison[])[];
  readonly factNames: readonly string[];
}

export type NarrativeInputPolicy =
  | "held"
  | "movement-and-signal"
  | "full"
  | "snapshot-navigation";

export interface ParsedNarrativeTransition {
  readonly guard: CompiledGuard;
  readonly events: readonly string[];
  readonly next: string;
}

export interface ParsedNarrativeState {
  readonly id: string;
  readonly inputPolicy: NarrativeInputPolicy;
  readonly enterEvents: readonly string[];
  readonly minimumDurationMs: number;
  readonly transitions: readonly ParsedNarrativeTransition[];
  readonly terminal: boolean;
}

export interface ParsedRunEndEligibility {
  readonly minimumRunMs: number;
  readonly minimumDistinctRooms: number;
  readonly acceptedReasons: readonly string[];
}

export interface ParsedNarrativeStateMachine {
  readonly id: string;
  readonly initialState: string;
  readonly terminalState: string;
  readonly stateOrder: readonly string[];
  readonly states: ReadonlyMap<string, ParsedNarrativeState>;
  readonly runEndEligibility: ParsedRunEndEligibility;
}

const INPUT_POLICIES: readonly NarrativeInputPolicy[] = Object.freeze([
  "held",
  "movement-and-signal",
  "full",
  "snapshot-navigation",
]);

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

function requireStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return Object.freeze(value.map((entry, index) =>
    requireNonEmptyString(entry, `${path}[${index}]`)));
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

interface GuardToken {
  readonly kind: "fact" | "number" | "string" | "boolean" | "null" | "operator" | "and" | "or";
  readonly text: string;
}

const OPERATOR_TOKENS: readonly string[] = ["==", "!=", ">=", "<=", ">", "<"];

function tokenizeGuard(source: string): readonly GuardToken[] {
  const tokens: GuardToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === " " || char === "\t") {
      index += 1;
      continue;
    }
    if (source.startsWith("&&", index)) {
      tokens.push({kind: "and", text: "&&"});
      index += 2;
      continue;
    }
    if (source.startsWith("||", index)) {
      tokens.push({kind: "or", text: "||"});
      index += 2;
      continue;
    }
    const operator = OPERATOR_TOKENS.find((candidate) => source.startsWith(candidate, index));
    if (operator !== undefined) {
      tokens.push({kind: "operator", text: operator});
      index += operator.length;
      continue;
    }
    if (char === "'") {
      const close = source.indexOf("'", index + 1);
      if (close < 0) throw new Error(`guard string literal is unterminated: ${source}`);
      tokens.push({kind: "string", text: source.slice(index + 1, close)});
      index = close + 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(source.slice(index));
      if (match === null) throw new Error(`guard number literal is malformed: ${source}`);
      tokens.push({kind: "number", text: match[0]});
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(index));
      if (match === null) throw new Error(`guard identifier is malformed: ${source}`);
      const text = match[0];
      if (text === "true" || text === "false") tokens.push({kind: "boolean", text});
      else if (text === "null") tokens.push({kind: "null", text});
      else tokens.push({kind: "fact", text});
      index += text.length;
      continue;
    }
    throw new Error(`guard contains an unsupported character '${char}': ${source}`);
  }
  return tokens;
}

function operandFromToken(token: GuardToken, source: string): GuardOperand {
  switch (token.kind) {
    case "fact":
      return Object.freeze({kind: "fact", factName: token.text, literal: null});
    case "number":
      return Object.freeze({kind: "literal", factName: "", literal: Number(token.text)});
    case "string":
      return Object.freeze({kind: "literal", factName: "", literal: token.text});
    case "boolean":
      return Object.freeze({kind: "literal", factName: "", literal: token.text === "true"});
    case "null":
      return Object.freeze({kind: "literal", factName: "", literal: null});
    default:
      throw new Error(`guard expected an operand, found '${token.text}': ${source}`);
  }
}

/**
 * Compile one authored guard string. Every referenced fact name must be in
 * `knownFactNames`; an unknown name throws so the conductor fails closed at
 * construction instead of evaluating a silent false at runtime.
 */
export function compileGuardExpression(
  sourceValue: string,
  knownFactNames: ReadonlySet<string>,
): CompiledGuard {
  const source = requireNonEmptyString(sourceValue, "guard expression");
  const tokens = tokenizeGuard(source);
  const disjunction: (readonly GuardComparison[])[] = [];
  let conjunction: GuardComparison[] = [];
  const factNames = new Set<string>();
  let cursor = 0;

  const takeComparison = (): GuardComparison => {
    const leftToken = tokens[cursor];
    if (leftToken === undefined) throw new Error(`guard ended before an operand: ${source}`);
    cursor += 1;
    const left = operandFromToken(leftToken, source);
    const operatorToken = tokens[cursor];
    if (operatorToken === undefined || operatorToken.kind !== "operator") {
      throw new Error(`guard comparison requires an operator: ${source}`);
    }
    cursor += 1;
    const rightToken = tokens[cursor];
    if (rightToken === undefined) throw new Error(`guard ended before an operand: ${source}`);
    cursor += 1;
    const right = operandFromToken(rightToken, source);
    for (const operand of [left, right]) {
      if (operand.kind !== "fact") continue;
      if (!knownFactNames.has(operand.factName)) {
        throw new Error(`guard references an unknown fact name: ${operand.factName}`);
      }
      factNames.add(operand.factName);
    }
    return Object.freeze({left, operator: operatorToken.text as GuardComparisonOperator, right});
  };

  conjunction.push(takeComparison());
  while (cursor < tokens.length) {
    const connective = tokens[cursor];
    if (connective === undefined) break;
    if (connective.kind === "and") {
      cursor += 1;
      conjunction.push(takeComparison());
      continue;
    }
    if (connective.kind === "or") {
      cursor += 1;
      disjunction.push(Object.freeze(conjunction));
      conjunction = [takeComparison()];
      continue;
    }
    throw new Error(`guard expected '&&' or '||', found '${connective.text}': ${source}`);
  }
  disjunction.push(Object.freeze(conjunction));

  return Object.freeze({
    source,
    disjunction: Object.freeze(disjunction),
    factNames: Object.freeze([...factNames].sort()),
  });
}

function resolveOperand(
  operand: GuardOperand,
  read: (factName: string) => GuardFactValue,
): GuardFactValue {
  return operand.kind === "fact" ? read(operand.factName) : operand.literal;
}

function evaluateComparison(
  comparison: GuardComparison,
  read: (factName: string) => GuardFactValue,
): boolean {
  const left = resolveOperand(comparison.left, read);
  const right = resolveOperand(comparison.right, read);
  switch (comparison.operator) {
    case "==":
    case "!=": {
      if (left !== null && right !== null && typeof left !== typeof right) {
        throw new Error(
          `guard compares mismatched types: ${String(left)} ${comparison.operator} ${String(right)}`,
        );
      }
      const equal = left === right;
      return comparison.operator === "==" ? equal : !equal;
    }
    default: {
      if (typeof left !== "number" || typeof right !== "number"
        || !Number.isFinite(left) || !Number.isFinite(right)) {
        throw new Error(
          `guard ordering comparison requires finite numbers: ${String(left)} ${comparison.operator} ${String(right)}`,
        );
      }
      switch (comparison.operator) {
        case ">=": return left >= right;
        case "<=": return left <= right;
        case ">": return left > right;
        case "<": return left < right;
        default: {
          const exhaustive: never = comparison.operator;
          throw new Error(`unsupported guard operator: ${String(exhaustive)}`);
        }
      }
    }
  }
}

export function evaluateCompiledGuard(
  guard: CompiledGuard,
  read: (factName: string) => GuardFactValue,
): boolean {
  for (const conjunction of guard.disjunction) {
    if (conjunction.every((comparison) => evaluateComparison(comparison, read))) return true;
  }
  return false;
}

/**
 * Parse the narrative run-cycle manifest into runtime data. All 16 states,
 * their input policies, their guards, and the run-end eligibility block are
 * validated here; a drifted manifest or a guard naming a fact outside the
 * conductor's registry throws (fail closed, per the repository contract).
 */
export function parseNarrativeStateMachine(
  manifestValue: unknown,
  knownFactNames: ReadonlySet<string>,
): ParsedNarrativeStateMachine {
  const manifest = requireRecord(manifestValue, "narrative state machine manifest");
  const id = requireNonEmptyString(manifest.id, "narrative manifest id");
  if (manifest.schemaVersion !== "4.0.0-narrative-state-machine" || id !== "narrative.run-cycle.v4") {
    throw new Error("narrative state machine manifest identity drifted");
  }
  const initialState = requireNonEmptyString(manifest.initialState, "narrative initialState");
  const terminalState = requireNonEmptyString(manifest.terminalState, "narrative terminalState");
  const statesRecord = requireRecord(manifest.states, "narrative states");
  const stateOrder = Object.freeze(Object.keys(statesRecord));
  if (stateOrder.length !== 16) {
    throw new Error(`narrative run cycle must author exactly 16 states, found ${stateOrder.length}`);
  }
  if (!stateOrder.includes(initialState)) throw new Error("narrative initialState is not authored");
  if (!stateOrder.includes(terminalState)) throw new Error("narrative terminalState is not authored");

  const states = new Map<string, ParsedNarrativeState>();
  for (const stateId of stateOrder) {
    const raw = requireRecord(statesRecord[stateId], `narrative state ${stateId}`);
    const inputPolicy = requireNonEmptyString(raw.inputPolicy, `narrative state ${stateId}.inputPolicy`);
    if (!INPUT_POLICIES.includes(inputPolicy as NarrativeInputPolicy)) {
      throw new Error(`narrative state ${stateId} has unknown input policy: ${inputPolicy}`);
    }
    const enterEvents = raw.enterEvents === undefined
      ? Object.freeze([] as string[])
      : requireStringArray(raw.enterEvents, `narrative state ${stateId}.enterEvents`);
    const minimumDurationMs = raw.minimumDurationMs === undefined
      ? 0
      : requireNonNegativeInteger(raw.minimumDurationMs, `narrative state ${stateId}.minimumDurationMs`);

    const transitions: ParsedNarrativeTransition[] = [];
    const hasExitGuard = raw.exitGuard !== undefined;
    const hasTransitions = raw.transitions !== undefined;
    if (hasExitGuard && hasTransitions) {
      throw new Error(`narrative state ${stateId} authors both exitGuard and transitions`);
    }
    if (hasExitGuard) {
      const guard = compileGuardExpression(
        requireNonEmptyString(raw.exitGuard, `narrative state ${stateId}.exitGuard`),
        knownFactNames,
      );
      const events = raw.exitEvents === undefined
        ? Object.freeze([] as string[])
        : requireStringArray(raw.exitEvents, `narrative state ${stateId}.exitEvents`);
      const next = requireNonEmptyString(raw.next, `narrative state ${stateId}.next`);
      transitions.push(Object.freeze({guard, events, next}));
    } else if (hasTransitions) {
      if (!Array.isArray(raw.transitions)) {
        throw new Error(`narrative state ${stateId}.transitions must be an array`);
      }
      for (const [index, entry] of raw.transitions.entries()) {
        const transition = requireRecord(entry, `narrative state ${stateId}.transitions[${index}]`);
        transitions.push(Object.freeze({
          guard: compileGuardExpression(
            requireNonEmptyString(
              transition.guard,
              `narrative state ${stateId}.transitions[${index}].guard`,
            ),
            knownFactNames,
          ),
          events: transition.events === undefined
            ? Object.freeze([] as string[])
            : requireStringArray(
                transition.events,
                `narrative state ${stateId}.transitions[${index}].events`,
              ),
          next: requireNonEmptyString(
            transition.next,
            `narrative state ${stateId}.transitions[${index}].next`,
          ),
        }));
      }
    } else if (stateId !== terminalState) {
      throw new Error(`narrative state ${stateId} authors no exit and is not terminal`);
    }

    states.set(stateId, Object.freeze({
      id: stateId,
      inputPolicy: inputPolicy as NarrativeInputPolicy,
      enterEvents,
      minimumDurationMs,
      transitions: Object.freeze(transitions),
      terminal: stateId === terminalState,
    }));
  }

  for (const state of states.values()) {
    for (const transition of state.transitions) {
      if (!states.has(transition.next)) {
        throw new Error(`narrative state ${state.id} targets unknown state: ${transition.next}`);
      }
    }
  }

  const eligibilityRecord = requireRecord(manifest.runEndEligibility, "narrative runEndEligibility");
  const minimumRunMs = requireNonNegativeInteger(
    eligibilityRecord.minimumRunMs,
    "narrative runEndEligibility.minimumRunMs",
  );
  const minimumDistinctRooms = requireNonNegativeInteger(
    eligibilityRecord.minimumDistinctRooms,
    "narrative runEndEligibility.minimumDistinctRooms",
  );
  const acceptedReasons = requireStringArray(
    eligibilityRecord.acceptedReasons,
    "narrative runEndEligibility.acceptedReasons",
  );
  if (acceptedReasons.length !== 8 || new Set(acceptedReasons).size !== 8) {
    throw new Error("narrative runEndEligibility must accept exactly 8 distinct reasons");
  }

  return Object.freeze({
    id,
    initialState,
    terminalState,
    stateOrder,
    states,
    runEndEligibility: Object.freeze({minimumRunMs, minimumDistinctRooms, acceptedReasons}),
  });
}
