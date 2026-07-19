import {describe, expect, it} from "vitest";
import {
  CANONICAL_EVENT_REGISTRY,
  CanonicalEventBus,
  type CanonicalGameplayEvent,
} from "../authority/events";
import {v4AudioOrNull, v4FrameOrNull} from "../assets/shared-v4";
import {
  FEEDBACK_ACCESSIBILITY_PRESETS,
  FEEDBACK_BOSS_PHASE_ORDER,
  FEEDBACK_GAZE_PULSE_INTERVAL_TICKS,
  FEEDBACK_NARRATIVE_CUES,
  FEEDBACK_NARRATIVE_PROJECTIONS,
  FEEDBACK_ROOM_SLUGS,
  FEEDBACK_RUNTIME_BINDINGS,
  FEEDBACK_WEATHER_SLUGS,
  FeedbackSubscriber,
  normalizeAccessibilityProfile,
  type FeedbackCueBatch,
  type FeedbackEventSource,
  type NarrativeProjectionContext,
} from "./feedback";

/* ------------------------------------------------------------------ *
 * Fixtures: real canonical events through a real bus.
 * ------------------------------------------------------------------ */

let nextOccurrence = 0;

function payloadFor(eventId: string, overrides: Readonly<Record<string, unknown>> = {}): unknown {
  const definition = CANONICAL_EVENT_REGISTRY[eventId];
  if (definition === undefined) throw new Error(`test fixture uses unknown event: ${eventId}`);
  const payload: Record<string, unknown> = {};
  for (const field of definition.requiredPayload) payload[field] = 0;
  return {...payload, ...overrides};
}

class Harness {
  readonly bus = new CanonicalEventBus();
  readonly subscriber: FeedbackSubscriber;
  #tick = 0;

  constructor(accessibility?: Readonly<Record<string, string>>) {
    this.subscriber = new FeedbackSubscriber(
      accessibility === undefined ? {} : {accessibility},
    );
  }

  get tick120(): number {
    return this.#tick;
  }

  /** Commit one event on its own tick and return the resulting cue batch. */
  emit(
    eventId: string,
    overrides: Readonly<Record<string, unknown>> = {},
    context: NarrativeProjectionContext = {},
  ): FeedbackCueBatch {
    this.#tick += 1;
    nextOccurrence += 1;
    this.bus.enqueue({
      id: eventId,
      tick120: this.#tick,
      entityStableId: "test-entity",
      localSequence: 0,
      occurrenceKey: `test:${eventId}:${nextOccurrence}`,
      payload: payloadFor(eventId, overrides),
    });
    this.bus.flush();
    return this.subscriber.consumeTick(this.#tick, this.bus, context);
  }

  /** Advance presentation time without committing anything. */
  idle(ticks: number): FeedbackCueBatch {
    this.#tick += ticks;
    return this.subscriber.consumeTick(this.#tick, this.bus);
  }
}

function allCues(batch: FeedbackCueBatch): readonly {
  readonly kind: string;
  readonly source: "runtime" | "narrative";
  readonly bindingId: string;
  readonly cueId: string;
  readonly eventName: string;
  readonly tick120: number;
  readonly dedupeKey: string;
}[] {
  return [...batch.visual, ...batch.audio, ...batch.ui, ...batch.haptic];
}

/* ------------------------------------------------------------------ *
 * Manifest coverage
 * ------------------------------------------------------------------ */

describe("authored binding universe", () => {
  it("binds exactly the 34 runtime cue resolvers and 37 narrative cues", () => {
    expect(FEEDBACK_RUNTIME_BINDINGS).toHaveLength(34);
    expect(FEEDBACK_NARRATIVE_CUES).toHaveLength(37);
    expect(FEEDBACK_NARRATIVE_PROJECTIONS).toHaveLength(37);
    expect(new Set(FEEDBACK_RUNTIME_BINDINGS.map((b) => b.bindingId)).size).toBe(34);
    expect(new Set(FEEDBACK_NARRATIVE_CUES.map((c) => c.cueId)).size).toBe(37);
  });

  it("mints every narrative cue name from event-projections, never from a second vocabulary", () => {
    const projected = new Set(FEEDBACK_NARRATIVE_PROJECTIONS.map((r) => r.narrativeEvent));
    for (const cue of FEEDBACK_NARRATIVE_CUES) {
      expect(projected.has(cue.narrativeEvent)).toBe(true);
    }
    expect(projected.size).toBe(FEEDBACK_NARRATIVE_CUES.length);
  });

  it("every literal resolver id exists in its authored universe", () => {
    for (const binding of FEEDBACK_RUNTIME_BINDINGS) {
      for (const spec of [binding.resolver, binding.fallbackResolver]) {
        if (spec === null || spec.shape !== "literal") continue;
        if (binding.kind === "visual") expect(v4FrameOrNull(spec.id)).not.toBeNull();
        if (binding.kind === "audio") expect(v4AudioOrNull(spec.id)).not.toBeNull();
      }
    }
    for (const cue of FEEDBACK_NARRATIVE_CUES) {
      if (cue.frame.shape === "literal") expect(v4FrameOrNull(cue.frame.id)).not.toBeNull();
      if (cue.audio.shape === "literal") expect(v4AudioOrNull(cue.audio.id)).not.toBeNull();
    }
  });

  it("every selector fallback exists in its authored universe", () => {
    for (const binding of FEEDBACK_RUNTIME_BINDINGS) {
      for (const spec of [binding.resolver, binding.fallbackResolver]) {
        if (spec === null || spec.shape !== "selector") continue;
        if (binding.kind === "visual") expect(v4FrameOrNull(spec.fallback)).not.toBeNull();
        if (binding.kind === "audio") expect(v4AudioOrNull(spec.fallback)).not.toBeNull();
      }
    }
  });

  it("carries the three authored resolver shapes", () => {
    const shapes = new Set(FEEDBACK_RUNTIME_BINDINGS.map((b) => b.resolver.shape));
    expect(shapes).toEqual(new Set(["literal", "selector", "haptic"]));
  });
});

/* ------------------------------------------------------------------ *
 * Every runtime binding resolves for its own event
 * ------------------------------------------------------------------ */

const RUNTIME_PAYLOAD_OVERRIDES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "room.transition.begin": {fromRoom: "INFORMATION", toRoom: "IN_BETWEEN"},
  "room.transition.world_swap.commit": {fromRoom: "INFORMATION", toRoom: "POLARIZED"},
  "weather.omen.begin": {weather: "STATIC"},
  "weather.active.begin": {weather: "STATIC"},
  "boss.phase.swap": {
    bossId: "boss.absent_receiver",
    fromPhaseId: "observe",
    toPhaseId: "enforce",
  },
  "boss.encounter.resolve": {
    bossId: "boss.absent_receiver",
    outcome: "protocol_interrupted",
    finalPhaseId: "fail_to_totalize",
  },
  "cross_run.scar.write.commit": {scarType: "overrideScar", roomId: "INFORMATION"},
};

describe("runtime cue resolution", () => {
  it("resolves all 34 runtime bindings for their own canonical events", () => {
    const harness = new Harness();
    const seen = new Set<string>();
    const eventIds = [...new Set(FEEDBACK_RUNTIME_BINDINGS.map((b) => b.eventId))];
    for (const eventId of eventIds) {
      const batch = harness.emit(eventId, RUNTIME_PAYLOAD_OVERRIDES[eventId] ?? {});
      for (const cue of allCues(batch)) {
        // Identity projections reuse the canonical name (gaze.clamp.release,
        // ghost.replay.begin, witness.turn), so filter on the authored source.
        if (cue.source === "runtime" && cue.eventName === eventId) seen.add(cue.bindingId);
      }
    }
    const expected = new Set(FEEDBACK_RUNTIME_BINDINGS.map((b) => b.bindingId));
    expect(seen).toEqual(expected);
    expect(seen.size).toBe(34);
  });

  it("routes each binding into the cue list its authored kind names", () => {
    const harness = new Harness();
    for (const binding of FEEDBACK_RUNTIME_BINDINGS) {
      const batch = harness.emit(
        binding.eventId,
        RUNTIME_PAYLOAD_OVERRIDES[binding.eventId] ?? {},
      );
      const list = binding.kind === "visual"
        ? batch.visual
        : binding.kind === "audio"
          ? batch.audio
          : binding.kind === "ui"
            ? batch.ui
            : batch.haptic;
      const match = list.find((cue) => cue.bindingId === binding.bindingId);
      expect(match, `${binding.bindingId} produced no ${binding.kind} cue`).toBeDefined();
      expect(match?.kind).toBe(binding.kind);
    }
  });

  it("emits an inline haptic pulse recipe verbatim", () => {
    const harness = new Harness();
    const batch = harness.emit("player.override.local_void.open");
    const cue = batch.haptic.find((entry) => entry.bindingId === "override-open-haptic");
    expect(cue?.pulses).toEqual([
      {atMs: 0, durationMs: 18, strength: 0.7},
      {atMs: 54, durationMs: 26, strength: 0.85},
    ]);
  });

  it("passes a ui resolver through as a hud cue id, not an asset id", () => {
    const harness = new Harness();
    const batch = harness.emit("snapshot.begin", {runId: "run-1"});
    const cue = batch.ui.find((entry) => entry.bindingId === "snapshot-begin-ui");
    expect(cue?.uiCueId).toBe("state_snapshot.observations");
    expect(v4FrameOrNull("state_snapshot.observations")).toBeNull();
    expect(v4AudioOrNull("state_snapshot.observations")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Every narrative projection mints
 * ------------------------------------------------------------------ */

interface NarrativeCase {
  readonly narrativeEvent: string;
  readonly eventId: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly context?: NarrativeProjectionContext;
}

const NARRATIVE_CASES: readonly NarrativeCase[] = [
  {
    narrativeEvent: "flower.band.enter.quiet",
    eventId: "flower.intensity.commit",
    context: {flowerBandEntered: "QUIET"},
  },
  {
    narrativeEvent: "flower.band.enter.middle",
    eventId: "flower.intensity.commit",
    context: {flowerBandEntered: "MIDDLE"},
  },
  {
    narrativeEvent: "flower.band.enter.loud",
    eventId: "flower.intensity.commit",
    context: {flowerBandEntered: "LOUD"},
  },
  {narrativeEvent: "gaze.acquire", eventId: "gaze.acquire.begin"},
  {narrativeEvent: "gaze.clamp.begin", eventId: "gaze.clamp.commit"},
  {narrativeEvent: "gaze.clamp.release", eventId: "gaze.clamp.release"},
  {
    narrativeEvent: "flower.recovery.complete",
    eventId: "flower.intensity.commit",
    payload: {source: "GAZE_RECOVERY"},
    context: {flowerRecoveryBandReached: true},
  },
  {
    narrativeEvent: "graze.evidence.accepted",
    eventId: "projectile.graze.commit",
    payload: {projectileId: "p-1", projectileGeneration: 1},
  },
  {
    narrativeEvent: "evidence.threshold.ready",
    eventId: "evidence.gain.commit",
    payload: {sourceKey: "k-1"},
    context: {evidenceThresholdReady: true},
  },
  {narrativeEvent: "override.charge.begin", eventId: "player.override.charge.begin"},
  {narrativeEvent: "localVoid.open", eventId: "player.override.local_void.open"},
  {narrativeEvent: "localVoid.decay.begin", eventId: "player.override.local_void.close"},
  {
    narrativeEvent: "overrideScar.materialize",
    eventId: "cross_run.scar.write.commit",
    payload: {scarType: "overrideScar", roomId: "INFORMATION"},
  },
  {narrativeEvent: "projectile.armed", eventId: "projectile.armed"},
  {narrativeEvent: "projectile.cancel", eventId: "projectile.cancel.commit"},
  {narrativeEvent: "projectile.impact", eventId: "projectile.impact.commit"},
  {narrativeEvent: "player.damage", eventId: "player.damage.commit"},
  {narrativeEvent: "player.collapse", eventId: "player.death.commit"},
  {narrativeEvent: "player.returnInput", eventId: "returnInput"},
  {
    narrativeEvent: "boss.protocol.phaseChanged",
    eventId: "boss.phase.swap",
    payload: {bossId: "boss.absent_receiver", fromPhaseId: "observe", toPhaseId: "enforce"},
  },
  {
    narrativeEvent: "boss.resolution.commit",
    eventId: "boss.encounter.resolve",
    payload: {
      bossId: "boss.absent_receiver",
      outcome: "protocol_interrupted",
      finalPhaseId: "fail_to_totalize",
    },
  },
  {
    narrativeEvent: "room.threshold.commit",
    eventId: "flower.intensity.commit",
    context: {roomThresholdCommitted: true},
  },
  {
    narrativeEvent: "cable.upload.begin",
    eventId: "flower.intensity.commit",
    context: {cableUploadBegan: true},
  },
  {
    narrativeEvent: "cable.burnIn.write",
    eventId: "gaze.clamp.commit",
    context: {cableBurnInWrote: true},
  },
  {
    narrativeEvent: "burnIn.capture",
    eventId: "snapshot.serialize.commit",
    payload: {snapshotHash: "hash", materialCounts: {burnIn: 2}},
  },
  {narrativeEvent: "ghost.replay.begin", eventId: "ghost.replay.begin"},
  {narrativeEvent: "ghost.replay.complete", eventId: "ghost.replay.complete"},
  {narrativeEvent: "witness.turn", eventId: "witness.turn"},
  {narrativeEvent: "snapshot.collect", eventId: "snapshot.begin", payload: {runId: "run-1"}},
  {
    narrativeEvent: "snapshot.handoff",
    eventId: "cross_run.record.persist.commit",
    payload: {runId: "run-1", snapshotHash: "hash"},
  },
  {
    narrativeEvent: "noDusk.binaryTimeCut.begin",
    eventId: "boss.phase.swap",
    payload: {bossId: "boss.no_dusk", fromPhaseId: "observe", toPhaseId: "enforce"},
  },
  {
    narrativeEvent: "weather.STATIC.phase",
    eventId: "weather.active.begin",
    payload: {weather: "STATIC"},
  },
  {
    narrativeEvent: "weather.RAIN.phase",
    eventId: "weather.active.begin",
    payload: {weather: "RAIN"},
  },
  {
    narrativeEvent: "weather.ASH.phase",
    eventId: "weather.active.begin",
    payload: {weather: "ASH"},
  },
  {
    narrativeEvent: "weather.WIND.phase",
    eventId: "weather.active.begin",
    payload: {weather: "WIND"},
  },
  {
    narrativeEvent: "weather.ECLIPSE.phase",
    eventId: "weather.active.begin",
    payload: {weather: "ECLIPSE"},
  },
];

describe("narrative projection", () => {
  it("covers every authored projection except the cadence-driven pulse", () => {
    const covered = new Set(NARRATIVE_CASES.map((entry) => entry.narrativeEvent));
    const authored = new Set(FEEDBACK_NARRATIVE_PROJECTIONS.map((r) => r.narrativeEvent));
    covered.add("gaze.clamp.pulse");
    expect(covered).toEqual(authored);
  });

  it.each(NARRATIVE_CASES)("mints $narrativeEvent", (entry) => {
    const harness = new Harness();
    const batch = harness.emit(entry.eventId, entry.payload ?? {}, entry.context ?? {});
    const minted = allCues(batch).filter((cue) => cue.eventName === entry.narrativeEvent);
    expect(minted.length).toBeGreaterThan(0);
    for (const cue of minted) expect(cue.tick120).toBe(harness.tick120);
  });

  it("stays silent when the gameplay fact the predicate needs is absent", () => {
    const harness = new Harness();
    const batch = harness.emit("flower.intensity.commit");
    const names = new Set(allCues(batch).map((cue) => cue.eventName));
    expect(names.has("flower.band.enter.quiet")).toBe(false);
    expect(names.has("room.threshold.commit")).toBe(false);
    expect(names.has("cable.upload.begin")).toBe(false);
  });

  it("accepts one graze evidence key exactly once", () => {
    const harness = new Harness();
    const first = harness.emit("projectile.graze.commit", {
      projectileId: "p-7",
      projectileGeneration: 3,
    });
    const second = harness.emit("projectile.graze.commit", {
      projectileId: "p-7",
      projectileGeneration: 3,
    });
    const accepted = (batch: FeedbackCueBatch): number =>
      allCues(batch).filter((cue) => cue.eventName === "graze.evidence.accepted").length;
    expect(accepted(first)).toBeGreaterThan(0);
    expect(accepted(second)).toBe(0);
  });

  it("carries the narrative ui column as authored prose and mints no invented pulse", () => {
    const harness = new Harness();
    const batch = harness.emit("player.damage.commit");
    const cue = batch.ui.find((entry) => entry.eventName === "player.damage");
    expect(cue?.note).toBe("body interruption marker");
    expect(batch.haptic.every((entry) => entry.source === "runtime")).toBe(true);
  });

  it("emits no ui cue where the narrative column authors 'none'", () => {
    const harness = new Harness();
    const batch = harness.emit("player.override.local_void.close");
    const decay = batch.ui.filter((cue) => cue.eventName === "localVoid.decay.begin");
    expect(decay).toHaveLength(0);
  });

  it("pulses the clamped gaze on the authored >=700ms cadence and stops on release", () => {
    expect(FEEDBACK_GAZE_PULSE_INTERVAL_TICKS).toBe(84);
    const harness = new Harness();
    const clamp = harness.emit("gaze.clamp.commit");
    expect(allCues(clamp).some((cue) => cue.eventName === "gaze.clamp.pulse")).toBe(true);

    const tooSoon = harness.idle(10);
    expect(allCues(tooSoon).some((cue) => cue.eventName === "gaze.clamp.pulse")).toBe(false);

    const due = harness.idle(FEEDBACK_GAZE_PULSE_INTERVAL_TICKS);
    expect(allCues(due).some((cue) => cue.eventName === "gaze.clamp.pulse")).toBe(true);

    harness.emit("gaze.clamp.release");
    const afterRelease = harness.idle(FEEDBACK_GAZE_PULSE_INTERVAL_TICKS * 2);
    expect(allCues(afterRelease).some((cue) => cue.eventName === "gaze.clamp.pulse")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Slug traps
 * ------------------------------------------------------------------ */

describe("selector substitution", () => {
  it("resolves the room slug through the manifest table, never by slugifying", () => {
    expect(FEEDBACK_ROOM_SLUGS["FORCED_ALIGNMENT"]).toBe("forced_choice");
    const harness = new Harness();
    const batch = harness.emit("room.transition.begin", {
      fromRoom: "INFORMATION",
      toRoom: "FORCED_ALIGNMENT",
    });
    const visual = batch.visual.find((cue) => cue.bindingId === "room-transition-visual");
    expect(visual?.frameId).toBe("threshold.forced_choice");
    expect(visual?.resolvedVia).toBe("selector");
    expect(v4FrameOrNull("threshold.forced_choice")).not.toBeNull();
  });

  it("resolves every authored room to an existing threshold frame", () => {
    for (const roomId of Object.keys(FEEDBACK_ROOM_SLUGS)) {
      const harness = new Harness();
      const batch = harness.emit("room.transition.world_swap.commit", {
        fromRoom: "INFORMATION",
        toRoom: roomId,
      });
      const visual = batch.visual.find((cue) => cue.bindingId === "room-world-swap-visual");
      expect(visual?.frameId).toBe(`threshold.${FEEDBACK_ROOM_SLUGS[roomId]}`);
      expect(visual?.resolvedVia).toBe("selector");
      expect(v4FrameOrNull(visual?.frameId ?? "")).not.toBeNull();
    }
  });

  it("strips the boss. prefix for bossSlug and keeps it for bossCanonicalId", () => {
    const harness = new Harness();
    const order = FEEDBACK_BOSS_PHASE_ORDER["boss.misreader"];
    expect(order).toBeDefined();
    const batch = harness.emit("boss.phase.swap", {
      bossId: "boss.misreader",
      fromPhaseId: order?.[0],
      toPhaseId: order?.[1],
    });
    const audio = batch.audio.find((cue) => cue.eventName === "boss.protocol.phaseChanged");
    expect(audio?.audioId).toBe("boss.misreader.signal");
    expect(audio?.resolvedVia).toBe("selector");
    const visual = batch.visual.find((cue) => cue.eventName === "boss.protocol.phaseChanged");
    expect(visual?.frameId).toBe("boss.misreader.phase2_live");
    expect(visual?.resolvedVia).toBe("selector");
  });

  it("numbers phaseIndex from 1 following the authored rig phase order", () => {
    for (const [bossId, order] of Object.entries(FEEDBACK_BOSS_PHASE_ORDER)) {
      const first = order[0];
      if (first === undefined) continue;
      const harness = new Harness();
      const batch = harness.emit("boss.phase.swap", {
        bossId,
        fromPhaseId: first,
        toPhaseId: first,
      });
      const visual = batch.visual.find((cue) => cue.eventName === "boss.protocol.phaseChanged");
      expect(visual?.frameId).toBe(`${bossId}.phase1_live`);
      expect(v4FrameOrNull(visual?.frameId ?? "")).not.toBeNull();
    }
  });

  it("falls back to the authored frame when the selector names no authored id", () => {
    const harness = new Harness();
    const order = FEEDBACK_BOSS_PHASE_ORDER["boss.no_dusk"];
    const third = order?.[2];
    expect(third).toBeDefined();
    expect(v4FrameOrNull("boss.no_dusk.phase3_live")).toBeNull();
    const batch = harness.emit("boss.phase.swap", {
      bossId: "boss.no_dusk",
      fromPhaseId: order?.[1],
      toPhaseId: third,
    });
    const visual = batch.visual.find((cue) => cue.eventName === "boss.protocol.phaseChanged");
    expect(visual?.frameId).toBe("boss_node.phase_divider");
    expect(visual?.resolvedVia).toBe("fallback");
  });

  it("lowercases the weather slug and resolves omen frames through the authored table", () => {
    expect(FEEDBACK_WEATHER_SLUGS["ECLIPSE"]).toBe("eclipse");
    const harness = new Harness();
    const batch = harness.emit("weather.omen.begin", {weather: "STATIC"});
    const visual = batch.visual.find((cue) => cue.bindingId === "weather-omen-visual");
    expect(visual?.frameId).toBe("weather.static_warning");
    expect(visual?.resolvedVia).toBe("selector");
  });

  it("resolves every runtime selector to an id inside the authored universe", () => {
    const rooms = Object.keys(FEEDBACK_ROOM_SLUGS);
    const weathers = Object.keys(FEEDBACK_WEATHER_SLUGS);
    const harness = new Harness();
    const batches: FeedbackCueBatch[] = [];
    for (const roomId of rooms) {
      batches.push(harness.emit("room.transition.begin", {
        fromRoom: "INFORMATION",
        toRoom: roomId,
      }));
      batches.push(harness.emit("room.transition.world_swap.commit", {
        fromRoom: "INFORMATION",
        toRoom: roomId,
      }));
    }
    for (const weather of weathers) {
      batches.push(harness.emit("weather.omen.begin", {weather}));
      batches.push(harness.emit("weather.active.begin", {weather}));
    }
    for (const bossId of Object.keys(FEEDBACK_BOSS_PHASE_ORDER)) {
      for (const phaseId of FEEDBACK_BOSS_PHASE_ORDER[bossId] ?? []) {
        batches.push(harness.emit("boss.phase.swap", {
          bossId,
          fromPhaseId: phaseId,
          toPhaseId: phaseId,
        }));
      }
    }
    let checked = 0;
    for (const batch of batches) {
      for (const cue of batch.visual) {
        expect(v4FrameOrNull(cue.frameId)).not.toBeNull();
        checked += 1;
      }
      for (const cue of batch.audio) {
        expect(v4AudioOrNull(cue.audioId)).not.toBeNull();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("pins the authored room-bed selector drift instead of hiding it", () => {
    // selectors.roomSlug spells FORCED_ALIGNMENT as forced_choice, but the audio
    // manifest ids the bed room.forced_alignment.bed. The selector therefore
    // misses and the authored fallback answers. This is manifest drift, pinned
    // here so it is visible: the audio layer must take beds from v4RoomBed(),
    // which resolves through the audio manifest's own room field.
    expect(v4AudioOrNull("room.forced_choice.bed")).toBeNull();
    const harness = new Harness();
    const drifted = harness.emit("room.transition.begin", {
      fromRoom: "INFORMATION",
      toRoom: "FORCED_ALIGNMENT",
    });
    const bed = drifted.audio.find((cue) => cue.bindingId === "room-transition-audio");
    expect(bed?.audioId).toBe("room.information.bed");
    expect(bed?.resolvedVia).toBe("fallback");

    const clean = harness.emit("room.transition.begin", {
      fromRoom: "FORCED_ALIGNMENT",
      toRoom: "POLARIZED",
    });
    const polarized = clean.audio.find((cue) => cue.bindingId === "room-transition-audio");
    expect(polarized?.audioId).toBe("room.polarized.bed");
    expect(polarized?.resolvedVia).toBe("selector");
  });

  it("uses the authored fallback when no substitution value is in scope", () => {
    const harness = new Harness();
    const batch = harness.emit("room.transition.begin", {fromRoom: 0, toRoom: 0});
    const visual = batch.visual.find((cue) => cue.bindingId === "room-transition-visual");
    expect(visual?.frameId).toBe("threshold.information");
    expect(visual?.resolvedVia).toBe("fallback");
  });
});

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

describe("accessibility fallbacks", () => {
  it("substitutes the authored fallback resolver under motion:reduced", () => {
    const full = new Harness(FEEDBACK_ACCESSIBILITY_PRESETS["full"]);
    const reduced = new Harness(FEEDBACK_ACCESSIBILITY_PRESETS["reducedMotion"]);
    const fullBatch = full.emit("gaze.clamp.commit");
    const reducedBatch = reduced.emit("gaze.clamp.commit");
    const pick = (batch: FeedbackCueBatch): {frameId: string; cueId: string} | undefined => {
      const cue = batch.visual.find((entry) => entry.bindingId === "gaze-clamp-visual");
      return cue === undefined ? undefined : {frameId: cue.frameId, cueId: cue.cueId};
    };
    expect(pick(fullBatch)).toEqual({
      frameId: "eye.clamp",
      cueId: "gaze.contrast-clamp.animated",
    });
    expect(pick(reducedBatch)).toEqual({
      frameId: "eye.pressure_hold",
      cueId: "gaze.contrast-clamp.steady",
    });
  });

  it("substitutes under flashing:off for a cue guarded by that axis", () => {
    const off = new Harness(FEEDBACK_ACCESSIBILITY_PRESETS["flashOff"]);
    const batch = off.emit("projectile.graze.commit", {projectileId: "p-2"});
    const cue = batch.visual.find((entry) => entry.bindingId === "graze-visual");
    expect(cue?.frameId).toBe("evidence.grain");
    expect(cue?.accessibilityConditions).toEqual(["flashing:off"]);
  });

  it("applies binaural:mono as an authored downmix on the room bed cue", () => {
    const spatial = new Harness(FEEDBACK_ACCESSIBILITY_PRESETS["full"]);
    const mono = new Harness(FEEDBACK_ACCESSIBILITY_PRESETS["maximumLegibility"]);
    const payload = {fromRoom: "INFORMATION", toRoom: "POLARIZED"};
    const spatialCue = spatial.emit("room.transition.begin", payload).audio
      .find((cue) => cue.bindingId === "room-transition-audio");
    const monoCue = mono.emit("room.transition.begin", payload).audio
      .find((cue) => cue.bindingId === "room-transition-audio");
    expect(spatialCue?.mix).toBeNull();
    expect(monoCue?.mix).toBe("mono");
    expect(monoCue?.audioId).toBe(spatialCue?.audioId);
  });

  it("suppresses haptics only where the axis authors 'off'", () => {
    const full = new Harness(FEEDBACK_ACCESSIBILITY_PRESETS["full"]);
    const silentHaptics = new Harness({...FEEDBACK_ACCESSIBILITY_PRESETS["full"], haptics: "off"});
    expect(full.emit("gaze.clamp.commit").haptic.length).toBeGreaterThan(0);
    expect(silentHaptics.emit("gaze.clamp.commit").haptic).toHaveLength(0);
  });

  it("leaves the gameplay event trace and every cue time bit-identical", () => {
    const script: readonly NarrativeCase[] = [
      {eventId: "gaze.clamp.commit", narrativeEvent: ""},
      {
        eventId: "projectile.graze.commit",
        narrativeEvent: "",
        payload: {projectileId: "p-9", projectileGeneration: 1},
      },
      {
        eventId: "room.transition.begin",
        narrativeEvent: "",
        payload: {fromRoom: "INFORMATION", toRoom: "IN_BETWEEN"},
      },
      {eventId: "player.override.local_void.open", narrativeEvent: ""},
      {eventId: "weather.omen.begin", narrativeEvent: "", payload: {weather: "STATIC"}},
    ];
    const run = (profile: Readonly<Record<string, string>> | undefined): {
      readonly trace: string;
      readonly cursor: number;
      readonly times: readonly string[];
      readonly frames: readonly string[];
    } => {
      const harness = new Harness(profile);
      const times: string[] = [];
      const frames: string[] = [];
      for (const step of script) {
        const batch = harness.emit(step.eventId, step.payload ?? {});
        for (const cue of batch.visual) {
          times.push(`${cue.tick120}:${cue.bindingId}:${cue.canonicalEventId}`);
          frames.push(cue.frameId);
        }
      }
      return {
        trace: harness.bus.canonicalSerialization().replace(/test:[^"]+/g, "occ"),
        cursor: harness.subscriber.consumedSequence,
        times,
        frames,
      };
    };
    const baseline = run(FEEDBACK_ACCESSIBILITY_PRESETS["full"]);
    const legible = run(FEEDBACK_ACCESSIBILITY_PRESETS["maximumLegibility"]);
    expect(legible.trace).toBe(baseline.trace);
    expect(legible.cursor).toBe(baseline.cursor);
    expect(legible.times).toEqual(baseline.times);
    expect(legible.frames).not.toEqual(baseline.frames);
  });

  it("rejects an unauthored accessibility axis or value", () => {
    expect(() => normalizeAccessibilityProfile({motion: "sideways"})).toThrow(/motion/);
    expect(() => normalizeAccessibilityProfile({tempo: "slow"})).toThrow(/unauthored axis/);
  });
});

/* ------------------------------------------------------------------ *
 * Silence, fail-closed, cursor
 * ------------------------------------------------------------------ */

describe("silence and fail-closed behaviour", () => {
  it("produces no cue at all for a canonical event no manifest binds", () => {
    const harness = new Harness();
    const batch = harness.emit("boss.phase.enter", {
      bossId: "boss.absent_receiver",
      generation: 1,
      phaseId: "observe",
    });
    expect(batch.visual).toHaveLength(0);
    expect(batch.audio).toHaveLength(0);
    expect(batch.ui).toHaveLength(0);
    expect(batch.haptic).toHaveLength(0);
    expect(batch.silent.map((entry) => entry.canonicalEventId)).toEqual(["boss.phase.enter"]);
  });

  it("fails closed on an event id outside the canonical registry", () => {
    const subscriber = new FeedbackSubscriber();
    const rogue = {
      id: "cue.invented.event",
      authority: "gameplay",
      tick120: 1,
      simulationTimeMs: 1000 / 120,
      phasePriority: 1,
      entityStableId: "x",
      localSequence: 0,
      sequence: 0,
      occurrenceKey: "rogue",
      payload: {},
    } as unknown as CanonicalGameplayEvent;
    const source: FeedbackEventSource = {
      committedEventCount: () => 1,
      committedEventsFrom: () => [rogue],
    };
    expect(() => subscriber.consumeTick(1, source)).toThrow(/non-canonical/);
  });

  it("rejects a backward or invalid presentation tick", () => {
    const harness = new Harness();
    harness.emit("gaze.acquire.begin");
    expect(() => harness.subscriber.consumeTick(0, harness.bus)).toThrow(/backward/);
    expect(() => harness.subscriber.consumeTick(-1, harness.bus)).toThrow(/non-negative/);
  });
});

describe("consumed-sequence cursor", () => {
  it("hands every committed event over exactly once", () => {
    const harness = new Harness();
    harness.emit("gaze.acquire.begin");
    harness.emit("player.damage.commit");
    expect(harness.subscriber.consumedSequence).toBe(harness.bus.committedEventCount());

    const empty = harness.idle(1);
    expect(empty.consumedEventCount).toBe(0);
    expect(empty.visual).toHaveLength(0);
    expect(harness.subscriber.consumedSequence).toBe(harness.bus.committedEventCount());
  });

  it("never repeats a dedupe key for the same sink across a run", () => {
    // policy.dedupeKey is "bindingId:eventOccurrenceKey": one cue fires once per
    // occurrence. A narrative cue legitimately reaches several sinks under one
    // key, so uniqueness is asserted per (key, sink kind).
    const harness = new Harness();
    const keys: string[] = [];
    for (const eventId of [...new Set(FEEDBACK_RUNTIME_BINDINGS.map((b) => b.eventId))]) {
      const batch = harness.emit(eventId, RUNTIME_PAYLOAD_OVERRIDES[eventId] ?? {});
      for (const cue of allCues(batch)) keys.push(`${cue.kind}|${cue.dedupeKey}`);
    }
    expect(keys.length).toBeGreaterThan(30);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not mutate or write back to the event bus", () => {
    const harness = new Harness();
    harness.emit("player.damage.commit");
    const before = harness.bus.canonicalSerialization();
    harness.idle(5);
    harness.idle(5);
    expect(harness.bus.canonicalSerialization()).toBe(before);
  });
});
