import {
  EventTrace,
  type GameplayEvent as V4GameplayEvent,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/events.ts";
import {
  FlowerIntensityResolver as V4FlowerIntensityResolver,
  type FlowerInputs as V4FlowerInputs,
  type FlowerResolution as V4FlowerResolution,
  type FlowerSource as V4FlowerSource,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/perception.ts";

import {CanonicalEventBus, simulationTimeMsForTick} from "./events";

export type FlowerIntensityInputs = V4FlowerInputs;
export type FlowerIntensityResolution = V4FlowerResolution;
export type FlowerIntensitySource = V4FlowerSource;

export interface FlowerIntensityAuthorityOptions {
  /** Stable event entity and occurrence namespace. */
  readonly authorityId?: string;
  /** Optional V4 resolver parameter. Values remain subject to V4 clamp01. */
  readonly gazeIntensity?: number;
  /** Optional V4 resolver parameter. Values remain subject to V4 clamp01. */
  readonly focusCap?: number;
}

export interface FlowerIntensitySnapshot {
  readonly authority: "v4-flower-intensity";
  readonly authorityId: string;
  /** Last accepted authority sample, or null before the first resolve. */
  readonly tick120: number | null;
  readonly commitCount: number;
  readonly resolution: Readonly<FlowerIntensityResolution> | null;
}

interface CapturedOptions {
  readonly authorityId: string;
  readonly gazeIntensity: number | undefined;
  readonly focusCap: number | undefined;
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

function optionalFinite(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : requireFinite(value, path);
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
    throw new Error("flower tick120 must be a non-negative safe integer");
  }
  return value as number;
}

function captureOptions(value: FlowerIntensityAuthorityOptions | undefined): CapturedOptions {
  if (value === undefined) {
    return Object.freeze({
      authorityId: "flower",
      gazeIntensity: undefined,
      focusCap: undefined,
    });
  }
  const record = requireRecord(value, "flower authority options");
  const authorityIdValue = ownDataValue(record, "authorityId", "flower authorityId", false);
  const gazeIntensityValue = ownDataValue(record, "gazeIntensity", "flower gazeIntensity", false);
  const focusCapValue = ownDataValue(record, "focusCap", "flower focusCap", false);
  return Object.freeze({
    authorityId: authorityIdValue === undefined
      ? "flower"
      : requireNonEmptyString(authorityIdValue, "flower authorityId"),
    gazeIntensity: optionalFinite(gazeIntensityValue, "flower gazeIntensity"),
    focusCap: optionalFinite(focusCapValue, "flower focusCap"),
  });
}

function captureInputs(value: FlowerIntensityInputs): Readonly<FlowerIntensityInputs> {
  const record = requireRecord(value, "flower inputs");
  return Object.freeze({
    signalIntensity: requireFinite(
      ownDataValue(record, "signalIntensity", "flower inputs.signalIntensity", true),
      "flower inputs.signalIntensity",
    ),
    focusActive: requireBoolean(
      ownDataValue(record, "focusActive", "flower inputs.focusActive", true),
      "flower inputs.focusActive",
    ),
    gazeClampActive: requireBoolean(
      ownDataValue(record, "gazeClampActive", "flower inputs.gazeClampActive", true),
      "flower inputs.gazeClampActive",
    ),
    overrideActive: requireBoolean(
      ownDataValue(record, "overrideActive", "flower inputs.overrideActive", true),
      "flower inputs.overrideActive",
    ),
  });
}

function freezeResolution(value: FlowerIntensityResolution): Readonly<FlowerIntensityResolution> {
  return Object.freeze({source: value.source, targetIntensity: value.targetIntensity});
}

function sameResolution(
  left: Readonly<FlowerIntensityResolution>,
  right: Readonly<FlowerIntensityResolution>,
): boolean {
  return left.source === right.source && left.targetIntensity === right.targetIntensity;
}

interface OracleProposal {
  readonly resolution: Readonly<FlowerIntensityResolution>;
  readonly commit: V4GameplayEvent | null;
}

/**
 * Resolve through a disposable V4 machine. Seeding it with the last accepted
 * input lets the immutable runtime remain the source for both priority and
 * change detection, while a rejected canonical-bus write can be discarded.
 */
function proposeWithV4(
  options: CapturedOptions,
  previousInputs: Readonly<FlowerIntensityInputs> | null,
  previousTick120: number | null,
  inputs: Readonly<FlowerIntensityInputs>,
  tick120: number,
): OracleProposal {
  const trace = new EventTrace();
  const resolver = new V4FlowerIntensityResolver(
    trace,
    options.gazeIntensity,
    options.focusCap,
  );
  if (previousInputs !== null) {
    if (previousTick120 === null) throw new Error("flower authority lost its previous tick");
    resolver.resolve(previousInputs, simulationTimeMsForTick(previousTick120));
  }
  const eventCountBeforeProposal = trace.events().length;
  const resolution = freezeResolution(
    resolver.resolve(inputs, simulationTimeMsForTick(tick120)),
  );
  const proposalEvents = trace.events().slice(eventCountBeforeProposal);
  if (proposalEvents.length > 1) {
    throw new Error("V4 FlowerIntensityResolver emitted more than one proposal event");
  }
  const commit = proposalEvents[0] ?? null;
  if (commit !== null) {
    if (commit.id !== "flower.intensity.commit") {
      throw new Error(`V4 FlowerIntensityResolver emitted unexpected event: ${commit.id}`);
    }
    if (
      commit.payload.source !== resolution.source
      || commit.payload.targetIntensity !== resolution.targetIntensity
    ) {
      throw new Error("V4 FlowerIntensityResolver event payload diverged from its resolution");
    }
  }
  return Object.freeze({resolution, commit});
}

/**
 * Tick-addressed production port for the immutable V4 flower priority
 * resolver. This class chooses no signal baseline; callers provide every V4
 * input explicitly, and presentation receives snapshots only.
 */
export class FlowerIntensityAuthority {
  readonly authorityId: string;
  private readonly options: CapturedOptions;
  private currentTick120: number | null = null;
  private lastInputs: Readonly<FlowerIntensityInputs> | null = null;
  private resolutionValue: Readonly<FlowerIntensityResolution> | null = null;
  private commitCountValue = 0;

  constructor(
    private readonly bus: CanonicalEventBus,
    options?: FlowerIntensityAuthorityOptions,
  ) {
    this.options = captureOptions(options);
    this.authorityId = this.options.authorityId;
  }

  resolve(inputsValue: FlowerIntensityInputs, tick120Value: number): Readonly<FlowerIntensityResolution> {
    const tick120 = requireTick120(tick120Value);
    if (this.currentTick120 !== null && tick120 < this.currentTick120) {
      throw new Error(
        `flower authority cannot move backward from tick ${this.currentTick120} to ${tick120}`,
      );
    }
    const inputs = captureInputs(inputsValue);
    const proposal = proposeWithV4(
      this.options,
      this.lastInputs,
      this.currentTick120,
      inputs,
      tick120,
    );
    const changed = this.resolutionValue === null
      || !sameResolution(this.resolutionValue, proposal.resolution);
    if (changed !== (proposal.commit !== null)) {
      throw new Error("V4 FlowerIntensityResolver change detection diverged from authority state");
    }

    if (proposal.commit !== null) {
      const nextCommit = this.commitCountValue + 1;
      this.bus.enqueue({
        id: "flower.intensity.commit",
        tick120,
        entityStableId: this.authorityId,
        localSequence: nextCommit - 1,
        occurrenceKey: `${this.authorityId}:${nextCommit}`,
        payload: proposal.commit.payload,
      });
      this.commitCountValue = nextCommit;
    }
    this.currentTick120 = tick120;
    this.lastInputs = inputs;
    this.resolutionValue = proposal.resolution;
    return proposal.resolution;
  }

  snapshot(): FlowerIntensitySnapshot {
    const resolution = this.resolutionValue === null
      ? null
      : freezeResolution(this.resolutionValue);
    return Object.freeze({
      authority: "v4-flower-intensity",
      authorityId: this.authorityId,
      tick120: this.currentTick120,
      commitCount: this.commitCountValue,
      resolution,
    });
  }
}
