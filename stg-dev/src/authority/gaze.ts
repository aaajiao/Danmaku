import runtimeStateMachinesJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";
import {EventTrace} from "../../../1bit-stg-complete-asset-kit-v4/runtime/events.ts";
import {
  GazeMachine as V4GazeMachine,
  type GazeSample as V4GazeSample,
  type GazeState as V4GazeState,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/perception.ts";

import {MASTER_TICK_HZ, tick120ToMilliseconds} from "./clock";
import {
  CanonicalEventBus,
  type GameplayEventDraft,
} from "./events";

export type GazeAuthoritySample = V4GazeSample;
export type GazeAuthorityState = V4GazeState;

export interface GazeAuthorityOptions {
  /** Stable entity and occurrence namespace. Gameplay parameters remain V4-owned. */
  readonly authorityId?: string;
}

export interface GazeAuthorityContract {
  readonly source: "state-machines-v4+runtime-perception";
  readonly pitchThresholdDegrees: number;
  readonly alignmentThreshold: number;
  readonly acquireMs: number;
  readonly acquireTicks120: number;
  readonly releaseDelayMs: number;
  readonly releaseDelayTicks120: number;
  readonly forcedIntensity: number;
}

export interface GazeAuthoritySnapshot {
  readonly authority: "v4-gaze";
  readonly authorityId: string;
  readonly tick120: number | null;
  readonly state: GazeAuthorityState;
  readonly clampActive: boolean;
  readonly cycle: number;
  readonly releaseAttempt: number;
  readonly deadlineTick120: number | null;
  readonly eventCount: number;
}

interface GazeMutableState {
  state: GazeAuthorityState;
  cycle: number;
  releaseAttempt: number;
  deadlineTick120: number | null;
}

interface GazeProposal extends GazeMutableState {
  readonly drafts: readonly GameplayEventDraft[];
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
  path: string,
  required: boolean,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    if (required) throw new Error(`${path} is required`);
    return undefined;
  }
  if (!("value" in descriptor)) throw new Error(`${path} must not be an accessor`);
  return descriptor.value;
}

function requireFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireNonNegativeFinite(value: unknown, path: string): number {
  const number = requireFinite(value, path);
  if (number < 0) throw new Error(`${path} must be non-negative`);
  return number;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireTick120(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error("gaze tick120 must be a non-negative safe integer");
  }
  return value as number;
}

function exactTicksForMs(value: number, path: string): number {
  const ticks = value * MASTER_TICK_HZ / 1000;
  if (!Number.isSafeInteger(ticks)) {
    throw new Error(`${path} must map exactly to tick120`);
  }
  return ticks;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function validateGazeAuthoritySample(
  value: GazeAuthoritySample,
): Readonly<GazeAuthoritySample> {
  const record = requireRecord(value, "gaze sample");
  return Object.freeze({
    skyEyeVisible: requireBoolean(
      ownDataValue(record, "skyEyeVisible", "gaze sample.skyEyeVisible", true),
      "gaze sample.skyEyeVisible",
    ),
    pitchDegrees: requireFinite(
      ownDataValue(record, "pitchDegrees", "gaze sample.pitchDegrees", true),
      "gaze sample.pitchDegrees",
    ),
    alignment: clamp01(requireFinite(
      ownDataValue(record, "alignment", "gaze sample.alignment", true),
      "gaze sample.alignment",
    )),
  });
}

function captureAuthorityId(value: GazeAuthorityOptions | undefined): string {
  if (value === undefined) return "gaze";
  const record = requireRecord(value, "gaze authority options");
  const authorityId = ownDataValue(record, "authorityId", "gaze authorityId", false);
  return authorityId === undefined
    ? "gaze"
    : requireNonEmptyString(authorityId, "gaze authorityId");
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return Object.freeze(value.map((entry, index) =>
    requireNonEmptyString(entry, `${path}[${index}]`)));
}

function parseManifestContract(): Omit<GazeAuthorityContract, "source" | "forcedIntensity"> {
  const root = requireRecord(runtimeStateMachinesJson, "runtime state machines manifest");
  if (
    ownDataValue(root, "schemaVersion", "runtime state machines manifest.schemaVersion", true)
      !== "4.0.0"
    || ownDataValue(root, "id", "runtime state machines manifest.id", true)
      !== "1bit.state-machines.v4"
  ) {
    throw new Error("V4 runtime state-machine manifest identity drifted");
  }
  const machines = ownDataValue(root, "machines", "runtime state machines manifest.machines", true);
  if (!Array.isArray(machines)) throw new Error("runtime state machines manifest.machines must be an array");
  const rawGazeMachines = machines.filter((entry) => {
    const record = requireRecord(entry, "runtime state machine");
    return ownDataValue(record, "id", "runtime state machine.id", true) === "gaze";
  });
  if (rawGazeMachines.length !== 1) throw new Error("V4 must define exactly one gaze machine");
  const gaze = requireRecord(rawGazeMachines[0], "V4 gaze machine");
  if (
    ownDataValue(gaze, "implementation", "V4 gaze machine.implementation", true) !== "GazeMachine"
    || ownDataValue(gaze, "type", "V4 gaze machine.type", true) !== "sustained-relation-fsm"
    || ownDataValue(gaze, "initialState", "V4 gaze machine.initialState", true) !== "idle"
  ) {
    throw new Error("V4 gaze machine identity drifted");
  }
  const states = stringArray(
    ownDataValue(gaze, "states", "V4 gaze machine.states", true),
    "V4 gaze machine.states",
  );
  if (JSON.stringify(states) !== JSON.stringify(["idle", "acquiring", "clamped", "release-delay"])) {
    throw new Error("V4 gaze state order drifted");
  }
  const transitions = ownDataValue(gaze, "transitions", "V4 gaze machine.transitions", true);
  if (!Array.isArray(transitions)) throw new Error("V4 gaze machine.transitions must be an array");
  const observedTransitions = transitions.map((entry, index) => {
    const transition = requireRecord(entry, `V4 gaze machine.transitions[${index}]`);
    return Object.freeze({
      from: requireNonEmptyString(
        ownDataValue(transition, "from", `V4 gaze machine.transitions[${index}].from`, true),
        `V4 gaze machine.transitions[${index}].from`,
      ),
      to: requireNonEmptyString(
        ownDataValue(transition, "to", `V4 gaze machine.transitions[${index}].to`, true),
        `V4 gaze machine.transitions[${index}].to`,
      ),
      trigger: requireNonEmptyString(
        ownDataValue(transition, "trigger", `V4 gaze machine.transitions[${index}].trigger`, true),
        `V4 gaze machine.transitions[${index}].trigger`,
      ),
      events: stringArray(
        ownDataValue(transition, "events", `V4 gaze machine.transitions[${index}].events`, true),
        `V4 gaze machine.transitions[${index}].events`,
      ),
    });
  });
  const expectedTransitions = [
    {from: "idle", to: "acquiring", trigger: "qualified-sky-eye-sample", events: ["gaze.acquire.begin"]},
    {from: "acquiring", to: "idle", trigger: "qualification-lost-before-deadline", events: ["gaze.acquire.cancel"]},
    {from: "acquiring", to: "clamped", trigger: "acquire-deadline", events: ["gaze.clamp.commit"]},
    {from: "clamped", to: "release-delay", trigger: "qualification-lost", events: ["gaze.release.begin"]},
    {from: "release-delay", to: "clamped", trigger: "qualification-restored", events: ["gaze.release.cancel"]},
    {from: "release-delay", to: "idle", trigger: "release-deadline", events: ["gaze.clamp.release"]},
  ];
  if (JSON.stringify(observedTransitions) !== JSON.stringify(expectedTransitions)) {
    throw new Error("V4 gaze transitions drifted");
  }
  const parameters = requireRecord(
    ownDataValue(gaze, "parameters", "V4 gaze machine.parameters", true),
    "V4 gaze machine.parameters",
  );
  const pitchThresholdDegrees = requireFinite(
    ownDataValue(parameters, "pitchThresholdDegrees", "V4 gaze pitch threshold", true),
    "V4 gaze pitch threshold",
  );
  const alignmentThreshold = requireFinite(
    ownDataValue(parameters, "alignmentThreshold", "V4 gaze alignment threshold", true),
    "V4 gaze alignment threshold",
  );
  const acquireMs = requireNonNegativeFinite(
    ownDataValue(parameters, "acquireMs", "V4 gaze acquireMs", true),
    "V4 gaze acquireMs",
  );
  const releaseDelayMs = requireNonNegativeFinite(
    ownDataValue(parameters, "releaseDelayMs", "V4 gaze releaseDelayMs", true),
    "V4 gaze releaseDelayMs",
  );
  if (pitchThresholdDegrees < -90 || pitchThresholdDegrees > 90) {
    throw new Error("V4 gaze pitch threshold is outside [-90,90]");
  }
  if (alignmentThreshold < 0 || alignmentThreshold > 1) {
    throw new Error("V4 gaze alignment threshold is outside [0,1]");
  }
  return Object.freeze({
    pitchThresholdDegrees,
    alignmentThreshold,
    acquireMs,
    acquireTicks120: exactTicksForMs(acquireMs, "V4 gaze acquireMs"),
    releaseDelayMs,
    releaseDelayTicks120: exactTicksForMs(releaseDelayMs, "V4 gaze releaseDelayMs"),
  });
}

function forcedIntensityFromOracle(
  contract: Omit<GazeAuthorityContract, "source" | "forcedIntensity">,
): number {
  const trace = new EventTrace();
  const machine = new V4GazeMachine(trace);
  if (
    machine.config.pitchThresholdDegrees !== contract.pitchThresholdDegrees
    || machine.config.alignmentThreshold !== contract.alignmentThreshold
    || machine.config.acquireMs !== contract.acquireMs
    || machine.config.releaseDelayMs !== contract.releaseDelayMs
  ) {
    throw new Error("V4 gaze runtime defaults diverged from the state-machine manifest");
  }
  machine.observe({
    skyEyeVisible: true,
    pitchDegrees: contract.pitchThresholdDegrees,
    alignment: contract.alignmentThreshold,
  }, 0);
  machine.advance(contract.acquireMs);
  const events = trace.events();
  const commit = events.find((event) => event.id === "gaze.clamp.commit");
  if (commit === undefined || events.length !== 2) {
    throw new Error("V4 gaze runtime did not produce its authored acquire/commit probe");
  }
  return requireFinite(commit.payload.forcedIntensity, "V4 gaze forced intensity");
}

const MANIFEST_CONTRACT = parseManifestContract();

export const GAZE_AUTHORITY_CONTRACT: GazeAuthorityContract = Object.freeze({
  source: "state-machines-v4+runtime-perception",
  ...MANIFEST_CONTRACT,
  forcedIntensity: forcedIntensityFromOracle(MANIFEST_CONTRACT),
});

function clampActive(state: GazeAuthorityState): boolean {
  return state === "clamped" || state === "release-delay";
}

/**
 * Tick-addressed production adapter for the immutable V4 sustained-gaze FSM.
 * Device semantics remain outside this class: callers must supply an explicit
 * sky-eye sample, and only committed runtime state is exposed to Flower.
 */
export class GazeAuthority {
  readonly authorityId: string;
  private currentTick120: number | null = null;
  private stateValue: GazeAuthorityState = "idle";
  private cycleValue = 0;
  private releaseAttemptValue = 0;
  private deadlineTick120Value: number | null = null;
  private eventCountValue = 0;

  constructor(
    private readonly bus: CanonicalEventBus,
    options?: GazeAuthorityOptions,
  ) {
    this.authorityId = captureAuthorityId(options);
  }

  observe(sampleValue: GazeAuthoritySample, tick120Value: number): GazeAuthoritySnapshot {
    const tick120 = this.validateTime(tick120Value);
    const sample = validateGazeAuthoritySample(sampleValue);
    const proposal = this.proposeAdvance(tick120);
    const qualifies = sample.skyEyeVisible
      && sample.pitchDegrees >= GAZE_AUTHORITY_CONTRACT.pitchThresholdDegrees
      && sample.alignment >= GAZE_AUTHORITY_CONTRACT.alignmentThreshold;

    switch (proposal.state) {
      case "idle":
        if (qualifies) {
          proposal.cycle += 1;
          proposal.releaseAttempt = 0;
          proposal.state = "acquiring";
          proposal.deadlineTick120 = tick120 + GAZE_AUTHORITY_CONTRACT.acquireTicks120;
          this.pushDraft(proposal, "gaze.acquire.begin", tick120, "acquire", {
            cycle: proposal.cycle,
            clampAtMs: tick120ToMilliseconds(proposal.deadlineTick120),
          });
        }
        break;
      case "acquiring":
        if (!qualifies) {
          proposal.state = "idle";
          proposal.deadlineTick120 = null;
          this.pushDraft(proposal, "gaze.acquire.cancel", tick120, "acquire-cancel", {
            cycle: proposal.cycle,
          });
        }
        break;
      case "clamped":
        if (!qualifies) {
          proposal.releaseAttempt += 1;
          proposal.state = "release-delay";
          proposal.deadlineTick120 = tick120 + GAZE_AUTHORITY_CONTRACT.releaseDelayTicks120;
          this.pushDraft(
            proposal,
            "gaze.release.begin",
            tick120,
            `release-begin:${proposal.releaseAttempt}`,
            {
              cycle: proposal.cycle,
              releaseAtMs: tick120ToMilliseconds(proposal.deadlineTick120),
            },
          );
        }
        break;
      case "release-delay":
        if (qualifies) {
          proposal.state = "clamped";
          proposal.deadlineTick120 = null;
          this.pushDraft(
            proposal,
            "gaze.release.cancel",
            tick120,
            `release-cancel:${proposal.releaseAttempt}`,
            {cycle: proposal.cycle, releaseAttempt: proposal.releaseAttempt},
          );
        }
        break;
      default: {
        const exhaustive: never = proposal.state;
        throw new Error(`unknown V4 gaze state: ${String(exhaustive)}`);
      }
    }

    return this.commit(proposal, tick120);
  }

  advance(tick120Value: number): GazeAuthoritySnapshot {
    const tick120 = this.validateTime(tick120Value);
    return this.commit(this.proposeAdvance(tick120), tick120);
  }

  snapshot(): GazeAuthoritySnapshot {
    return Object.freeze({
      authority: "v4-gaze",
      authorityId: this.authorityId,
      tick120: this.currentTick120,
      state: this.stateValue,
      clampActive: clampActive(this.stateValue),
      cycle: this.cycleValue,
      releaseAttempt: this.releaseAttemptValue,
      deadlineTick120: this.deadlineTick120Value,
      eventCount: this.eventCountValue,
    });
  }

  private validateTime(value: number): number {
    const tick120 = requireTick120(value);
    if (this.currentTick120 !== null && tick120 < this.currentTick120) {
      throw new Error(
        `gaze authority cannot move backward from tick ${this.currentTick120} to ${tick120}`,
      );
    }
    return tick120;
  }

  private proposeAdvance(toTick120: number): GazeProposal {
    const proposal: GazeProposal = {
      state: this.stateValue,
      cycle: this.cycleValue,
      releaseAttempt: this.releaseAttemptValue,
      deadlineTick120: this.deadlineTick120Value,
      drafts: [],
    };
    if (proposal.deadlineTick120 === null || toTick120 < proposal.deadlineTick120) {
      return proposal;
    }
    const dueTick120 = proposal.deadlineTick120;
    if (proposal.state === "acquiring") {
      proposal.state = "clamped";
      proposal.deadlineTick120 = null;
      this.pushDraft(proposal, "gaze.clamp.commit", dueTick120, "clamp", {
        cycle: proposal.cycle,
        forcedIntensity: GAZE_AUTHORITY_CONTRACT.forcedIntensity,
      });
    } else if (proposal.state === "release-delay") {
      proposal.state = "idle";
      proposal.deadlineTick120 = null;
      this.pushDraft(
        proposal,
        "gaze.clamp.release",
        dueTick120,
        `release:${proposal.releaseAttempt}`,
        {cycle: proposal.cycle, releaseAttempt: proposal.releaseAttempt},
      );
    } else {
      throw new Error("gaze authority retained a deadline outside a timed state");
    }
    return proposal;
  }

  private pushDraft(
    proposal: GazeProposal,
    id: string,
    tick120: number,
    occurrenceSuffix: string,
    payload: Record<string, number>,
  ): void {
    (proposal.drafts as GameplayEventDraft[]).push(Object.freeze({
      id,
      tick120,
      entityStableId: this.authorityId,
      localSequence: this.eventCountValue + proposal.drafts.length,
      occurrenceKey: `${this.authorityId}:${proposal.cycle}:${occurrenceSuffix}`,
      payload: Object.freeze({...payload}),
    }));
  }

  private commit(proposal: GazeProposal, tick120: number): GazeAuthoritySnapshot {
    if (proposal.drafts.length > 0) this.bus.enqueueBatch(proposal.drafts);
    this.currentTick120 = tick120;
    this.stateValue = proposal.state;
    this.cycleValue = proposal.cycle;
    this.releaseAttemptValue = proposal.releaseAttempt;
    this.deadlineTick120Value = proposal.deadlineTick120;
    this.eventCountValue += proposal.drafts.length;
    return this.snapshot();
  }
}
