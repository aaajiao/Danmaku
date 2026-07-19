import assetBindingsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-v4.json";
import feedbackBindingsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/feedback-bindings-v4.json";
import frameIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import {assertV4SchemaVersion} from "./v4-runtime-asset";

type FeedbackKind = "visual" | "audio" | "haptic";

interface FeedbackBindingContract {
  readonly id: string;
  readonly eventId: string;
  readonly sink: Readonly<{kind: string; cueId: string}>;
  readonly fallback?: Readonly<{cueId: string; when: readonly string[]}>;
}

interface RuntimeCueResolverContract {
  readonly bindingId: string;
  readonly eventId: string;
  readonly kind: string;
  readonly cueId: string;
  readonly resolver: unknown;
  readonly accessibilityFallback?: Readonly<{
    cueId: string;
    when: readonly string[];
    resolver: unknown;
  }>;
}

export interface V4HapticPulse {
  readonly atMs: number;
  readonly durationMs: number;
  readonly strength: number;
}

const feedbackBindings = feedbackBindingsManifest.bindings as readonly FeedbackBindingContract[];
const runtimeCueResolvers = assetBindingsManifest.runtimeCueResolvers as unknown as readonly RuntimeCueResolverContract[];
const frameIds = new Set(frameIndexManifest.frames.map((frame) => frame.semanticId));

assertV4SchemaVersion("V4 feedback bindings", feedbackBindingsManifest.schemaVersion, "4.0.0");
assertV4SchemaVersion(
  "V4 asset bindings",
  assetBindingsManifest.schemaVersion,
  "4.0.0-asset-bindings",
);
assertV4SchemaVersion("V4 frame index", frameIndexManifest.schemaVersion, "4.0.0");
if (
  feedbackBindingsManifest.policy.sourceKind !== "gameplay-event"
  || feedbackBindingsManifest.policy.sinkMayEmitGameplay !== false
  || feedbackBindingsManifest.policy.dedupeKey !== "bindingId:eventOccurrenceKey"
) {
  throw new Error("V4 feedback authority policy drifted");
}

function sameConditions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((condition, index) => condition === right[index]);
}

export function requiredFeedbackResolver(
  bindingId: string,
  eventId: string,
  kind: FeedbackKind,
): Readonly<{
  binding: FeedbackBindingContract;
  resolver: RuntimeCueResolverContract;
}> {
  const bindingMatches = feedbackBindings.filter((entry) => entry.id === bindingId);
  const resolverMatches = runtimeCueResolvers.filter((entry) => entry.bindingId === bindingId);
  if (bindingMatches.length !== 1 || resolverMatches.length !== 1) {
    throw new Error(`V4 feedback requires one binding and resolver for ${bindingId}`);
  }
  const binding = bindingMatches[0];
  const resolver = resolverMatches[0];
  if (
    binding === undefined
    || resolver === undefined
    || binding.eventId !== eventId
    || resolver.eventId !== eventId
    || binding.sink.kind !== kind
    || resolver.kind !== kind
    || binding.sink.cueId !== resolver.cueId
  ) {
    throw new Error(`V4 feedback identity drifted for ${bindingId}`);
  }
  const bindingFallback = binding.fallback;
  const resolverFallback = resolver.accessibilityFallback;
  if ((bindingFallback === undefined) !== (resolverFallback === undefined)) {
    throw new Error(`V4 feedback fallback drifted for ${bindingId}`);
  }
  if (
    bindingFallback !== undefined
    && resolverFallback !== undefined
    && (
      bindingFallback.cueId !== resolverFallback.cueId
      || !sameConditions(bindingFallback.when, resolverFallback.when)
    )
  ) {
    throw new Error(`V4 feedback fallback identity drifted for ${bindingId}`);
  }
  return Object.freeze({binding, resolver});
}

export function requiredStringResolver(value: unknown, bindingId: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`V4 feedback resolver is invalid for ${bindingId}`);
  }
  return value;
}

export function requiredFrame(value: unknown, bindingId: string): string {
  const frameId = requiredStringResolver(value, bindingId);
  if (!frameIds.has(frameId)) {
    throw new Error(`V4 feedback ${bindingId} references unknown frame ${frameId}`);
  }
  return frameId;
}

export function requiredHapticPulses(
  value: unknown,
  bindingId: string,
): readonly Readonly<V4HapticPulse>[] {
  if (typeof value !== "object" || value === null || !("pulses" in value)) {
    throw new Error(`V4 haptic resolver is invalid for ${bindingId}`);
  }
  const pulses = (value as {readonly pulses?: unknown}).pulses;
  if (!Array.isArray(pulses) || pulses.length === 0) {
    throw new Error(`V4 haptic resolver has no pulses for ${bindingId}`);
  }
  return Object.freeze(pulses.map((pulse): Readonly<V4HapticPulse> => {
    if (typeof pulse !== "object" || pulse === null) {
      throw new Error(`V4 haptic pulse is invalid for ${bindingId}`);
    }
    const {atMs, durationMs, strength} = pulse as Record<string, unknown>;
    if (
      typeof atMs !== "number"
      || typeof durationMs !== "number"
      || typeof strength !== "number"
      || !Number.isFinite(atMs)
      || !Number.isFinite(durationMs)
      || !Number.isFinite(strength)
      || atMs < 0
      || durationMs <= 0
      || strength < 0
      || strength > 1
    ) {
      throw new Error(`V4 haptic pulse values are invalid for ${bindingId}`);
    }
    return Object.freeze({atMs, durationMs, strength});
  }));
}
