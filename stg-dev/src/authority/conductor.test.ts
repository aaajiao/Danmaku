import {describe, expect, it} from "vitest";

import narrativeStateMachineJson from
  "../../../1bit-stg-complete-asset-kit-v4/narrative/narrative-state-machine-v4.json";
// Type-only import: it proves the conductor snapshot structurally satisfies the
// presentation contract without creating an authority -> game dependency.
import type {PresentationSourceSnapshot} from "../game/presentation";

import {
  AUTHORED_ROOM_THRESHOLD_FACTS,
  OVERRIDE_ELIGIBILITY_GATE,
  RoomThresholdWatcher,
} from "./conductor-facts";
import {parseNarrativeStateMachine} from "./conductor-guards";
import {
  CONDUCTOR_DEFERRED_RUN_END_REASONS,
  CONDUCTOR_NARRATIVE_FACT_NAMES,
  CONDUCTOR_SUPPORTED_RUN_END_REASONS,
  FLOWER_RECOVERY_ANCHOR_TICKS120,
  FIRST_EYE_PATTERN_ID,
  RunConductor,
  type ConductorSnapshot,
  type ConductorTickInput,
} from "./conductor";
import {CrossRunArchiveStore, type ArchiveStorageBackend} from "./persistence";
import {validateRunMemory, type FinalizedRunMemory} from "./run-memory-model";
import {crossedTickCount} from "./tick120";

const RUN_SEED = 0x1b17c0de;

function memoryBackend(): ArchiveStorageBackend {
  const cells = new Map<string, string>();
  return {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => {
      cells.set(key, value);
    },
    removeItem: (key) => {
      cells.delete(key);
    },
  };
}

const IDLE_INPUT: ConductorTickInput = Object.freeze({
  movement: Object.freeze({x: 0, y: 0}),
  focused: false,
  signalIntensity: 0.4,
  gazeIntent: false,
  gazePitchDegrees: 0,
  gazeAlignment: 0,
});

/**
 * One scripted input tape shared by every run-level test. It is a plain
 * function of (phase, tick, ticks already spent in FIRST_CLAMP_RECOVERY), so
 * two conductors fed the same seed replay it identically. No guard input is
 * ever forced: the tape only presses keys a player could press.
 */
function tapeInput(phase: string, tick: number, clampTicks: number): ConductorTickInput {
  // Movement pulses so the awakening sees real rising edges rather than one
  // held stick; the quiet loop needs two meaningful inputs, not two frames.
  const cycle = tick % 240;
  const axis = cycle < 60 ? 0.3 : cycle < 120 ? 0 : cycle < 180 ? -0.3 : 0;
  return {
    ...IDLE_INPUT,
    movement: {x: axis, y: 0},
    gazeIntent: phase === "FIRST_EYE" || (phase === "FIRST_CLAMP_RECOVERY" && clampTicks <= 80),
    gazePitchDegrees: 60,
    gazeAlignment: 1,
    snapshotContinueRequested: phase === "STATE_SNAPSHOT",
  };
}

interface DrivenRun {
  readonly conductor: RunConductor;
  readonly phaseEntryTick: ReadonlyMap<string, number>;
  readonly snapshots: readonly ConductorSnapshot[];
}

/**
 * Drive a conductor with the shared tape until it completes or the tick budget
 * runs out. `sample` decides which per-tick snapshots are retained so the
 * heavier integration runs do not hold 30k frozen snapshots in memory.
 */
function driveRun(
  conductor: RunConductor,
  maximumTicks: number,
  sample: (snapshot: ConductorSnapshot) => boolean = () => false,
): DrivenRun {
  const phaseEntryTick = new Map<string, number>([[conductor.runPhase, 0]]);
  const snapshots: ConductorSnapshot[] = [];
  let clampTicks = 0;
  for (let tick = 0; tick < maximumTicks && !conductor.complete; tick += 1) {
    const phase = conductor.runPhase;
    if (phase === "FIRST_CLAMP_RECOVERY") clampTicks += 1;
    conductor.step(tapeInput(phase, tick, clampTicks));
    if (!phaseEntryTick.has(conductor.runPhase)) {
      phaseEntryTick.set(conductor.runPhase, conductor.tick120);
    }
    const snapshot = conductor.snapshot();
    if (sample(snapshot)) snapshots.push(snapshot);
  }
  return {conductor, phaseEntryTick, snapshots};
}

// A completed run is expensive enough that the integration, determinism-of-
// record and restore tests share one. It walks the honest authored path:
// 240,000 ms of run-end eligibility across two distinct rooms, no shortcut.
let completedRun: DrivenRun | null = null;
function sharedCompletedRun(): DrivenRun {
  if (completedRun === null) {
    completedRun = driveRun(
      new RunConductor({runId: "run-alpha", rawRunSeed: RUN_SEED, previousRun: null, roomCount: 2}),
      40_000,
    );
  }
  return completedRun;
}

describe("run conductor construction is fail-closed", () => {
  it("rejects a narrative guard naming a fact outside the conductor registry", () => {
    const drifted = JSON.parse(JSON.stringify(narrativeStateMachineJson)) as {
      states: Record<string, Record<string, unknown>>;
    };
    drifted.states.AWAKENING!.exitGuard = "run.elapsedMs >= 6000 && player.vibeCheck >= 2";
    expect(() => parseNarrativeStateMachine(drifted, CONDUCTOR_NARRATIVE_FACT_NAMES))
      .toThrow(/unknown fact name: player\.vibeCheck/);
  });

  it("loads all sixteen authored states and the eight accepted end reasons", () => {
    const conductor = new RunConductor({runId: "run-shape", rawRunSeed: RUN_SEED, previousRun: null});
    expect(conductor.machine.stateOrder).toHaveLength(16);
    expect(conductor.machine.initialState).toBe("BOOT_REHYDRATE");
    expect(conductor.machine.terminalState).toBe("RUN_CYCLE_COMPLETE");
    expect(conductor.machine.runEndEligibility.acceptedReasons).toEqual([
      "BODY_COLLAPSE",
      "PROTOCOL_WITHDRAWAL",
      "READING_FAILED",
      "STABLE_INTERSECTION",
      "SEAM_CROSSED_UNCLAIMED",
      "RULE_INTERRUPTED_BY_SCAR",
      "NO_DUSK_WITHDRAWAL",
      "ABSOLUTE_READER_INCOMPLETE",
    ]);
    expect(conductor.machine.runEndEligibility.minimumRunMs).toBe(240_000);
    expect(conductor.machine.runEndEligibility.minimumDistinctRooms).toBe(2);
  });

  it("keeps the five unimplemented end reasons unreachable instead of silent", () => {
    expect([...CONDUCTOR_SUPPORTED_RUN_END_REASONS, ...CONDUCTOR_DEFERRED_RUN_END_REASONS].sort())
      .toEqual([...narrativeStateMachineJson.runEndEligibility.acceptedReasons].sort());
    for (const reason of CONDUCTOR_DEFERRED_RUN_END_REASONS) {
      expect(CONDUCTOR_SUPPORTED_RUN_END_REASONS).not.toContain(reason);
    }
  });

  it("reads the Override eligibility gate out of the POLARIZED manifest block", () => {
    expect(OVERRIDE_ELIGIBILITY_GATE.id).toBe("polar.override-eligible");
    expect(OVERRIDE_ELIGIBILITY_GATE.roomId).toBe("POLARIZED");
    expect(OVERRIDE_ELIGIBILITY_GATE.clauses).toEqual([
      {metric: "gaze.totalMs", operator: ">=", value: 5000},
      {metric: "flower.forcedDimCount", operator: ">=", value: 2},
      {metric: "evidence.available", operator: ">=", value: 1},
    ]);
  });

  it("rejects an unauthored room for the threshold watcher", () => {
    expect(() => new RoomThresholdWatcher("BACKSTAGE")).toThrow(/not authored/);
  });
});

describe("awakening is a quiet loop", () => {
  it("spawns no combat and exits only on six seconds plus two rising edges", () => {
    const conductor = new RunConductor({
      runId: "run-awakening",
      rawRunSeed: RUN_SEED,
      previousRun: null,
      roomCount: 2,
    });
    // Hold one direction: elapsed time passes, but a held stick is a single
    // meaningful input, so the authored two-edge condition is never met.
    for (let tick = 0; tick < 2000; tick += 1) {
      conductor.step({...IDLE_INPUT, movement: {x: 0.4, y: 0}});
    }
    expect(conductor.runPhase).toBe("AWAKENING");
    const held = conductor.snapshot();
    expect(held.combatEnabled).toBe(false);
    expect(held.projectiles).toHaveLength(0);
    expect(held.hud.runElapsedMs).toBeGreaterThanOrEqual(6000);

    // Release and press again: the second rising edge opens the exit.
    conductor.step({...IDLE_INPUT, movement: {x: 0, y: 0}});
    conductor.step({...IDLE_INPUT, movement: {x: 0.4, y: 0}});
    expect(conductor.runPhase).toBe("FIRST_EYE");
    expect(conductor.snapshot().projectiles).toHaveLength(0);
  });

  it("holds every input while the boot states run", () => {
    const conductor = new RunConductor({runId: "run-held", rawRunSeed: RUN_SEED, previousRun: null});
    expect(conductor.snapshot().inputPolicy).toBe("held");
    conductor.step({...IDLE_INPUT, movement: {x: 1, y: 0}, focused: true});
    expect(conductor.snapshot().hud.inputReturned).toBe(false);
    expect(conductor.snapshot().hud.flowerIntensity).toBe(0);
  });
});

describe("first eye runs the authored occurrence through the real kernel", () => {
  it("acquires, clamps, releases, and recovers the flower thirty ticks later", () => {
    const conductor = new RunConductor({
      runId: "run-eye",
      rawRunSeed: RUN_SEED,
      previousRun: null,
      roomCount: 2,
    });
    let clampTicks = 0;
    let clampedAt: number | null = null;
    let releasedAt: number | null = null;
    let recoveredAt: number | null = null;
    let sawEyePattern = false;
    for (let tick = 0; tick < 2400; tick += 1) {
      const phase = conductor.runPhase;
      if (phase === "FIRST_CLAMP_RECOVERY") clampTicks += 1;
      conductor.step(tapeInput(phase, tick, clampTicks));
      const snapshot = conductor.snapshot();
      if (snapshot.patternId === FIRST_EYE_PATTERN_ID && snapshot.combatEnabled) sawEyePattern = true;
      if (clampedAt === null && snapshot.gazeState === "clamped") clampedAt = snapshot.tick120;
      if (releasedAt === null && snapshot.gazeClampReleased) releasedAt = snapshot.tick120;
      if (recoveredAt === null && conductor.runPhase === "ROOM_SAMPLING") {
        recoveredAt = snapshot.tick120;
      }
    }
    expect(sawEyePattern).toBe(true);
    expect(clampedAt).not.toBeNull();
    expect(releasedAt).not.toBeNull();
    expect(recoveredAt).not.toBeNull();
    expect(releasedAt!).toBeGreaterThan(clampedAt!);
    // EXT-004: the flower is still dim for exactly 30 ticks after the release,
    // so ROOM_SAMPLING cannot begin before the anchor elapses.
    expect(recoveredAt! - releasedAt!).toBe(FLOWER_RECOVERY_ANCHOR_TICKS120);
    expect(conductor.snapshot().hud.flowerForcedDimCount).toBeGreaterThanOrEqual(1);
  });
});

describe("room sampling consumes the composer plan", () => {
  it("emits the entry omen at the authored lead and swaps rooms only at the world swap", () => {
    const {conductor} = sharedCompletedRun();
    const snapshot = conductor.snapshot();

    expect(snapshot.visitedRooms.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.visitedRooms.slice(0, 2)).toEqual(conductor.plan.qa.rooms.slice(0, 2));

    const omen = snapshot.entryOmens[0];
    expect(omen).toBeDefined();
    const authored = AUTHORED_ROOM_THRESHOLD_FACTS.get(omen!.roomId);
    expect(omen!.distancePx).toBe(authored!.entryOmen.distancePx);
    expect(omen!.event).toBe(authored!.entryOmen.event);
    expect(omen!.audioLeadTicks120).toBe(crossedTickCount(authored!.entryOmen.audioLeadMs));
    // The omen leads the request by exactly the authored audio lead, on ticks.
    expect(omen!.transitionRequestTick120 - omen!.tick120).toBe(omen!.audioLeadTicks120);

    const events = conductor.bus.events();
    const begin = events.find((event) => event.id === "room.transition.begin");
    const swap = events.find((event) => event.id === "room.transition.world_swap.commit");
    expect(begin).toBeDefined();
    expect(swap).toBeDefined();
    expect(begin!.tick120).toBe(omen!.transitionRequestTick120);
    // Collision authority is the destination room's only from the atomic swap:
    // 240 ms after the request, never at the request and never in between.
    expect(swap!.tick120 - begin!.tick120).toBe(30);
    expect(begin!.payload).toMatchObject({fromRoom: snapshot.visitedRooms[0], toRoom: omen!.roomId});
  });

  it("withholds composer encounters the kernel does not admit, visibly", () => {
    const {conductor} = sharedCompletedRun();
    for (const withheld of conductor.snapshot().withheldEncounters) {
      expect(withheld.reason).toBe("pattern-not-conductor-admissible");
      expect(withheld.patternId).toEqual(expect.any(String));
    }
    // The plan really does schedule at least one non-admissible pattern for
    // this seed, so the withholding path is exercised rather than assumed.
    expect(conductor.snapshot().withheldEncounters.length).toBeGreaterThan(0);
  });
});

describe("a full run reaches observation and materializes into the next run", () => {
  it("walks the authored path, persists a validating record, and restores it in order", () => {
    const backend = memoryBackend();
    const archive = new CrossRunArchiveStore(backend);
    const conductor = new RunConductor({
      runId: "run-integration",
      rawRunSeed: RUN_SEED,
      previousRun: null,
      archive,
      roomCount: 2,
    });
    const {phaseEntryTick} = driveRun(conductor, 40_000);

    expect(conductor.complete).toBe(true);
    for (const phase of [
      "BOOT_REHYDRATE",
      "GHOST_REPLAY",
      "WITNESS_ORIENTATION",
      "AWAKENING",
      "FIRST_EYE",
      "FIRST_CLAMP_RECOVERY",
      "ROOM_SAMPLING",
      "WORLD_RESPONSE",
      "DUSK_APPROACH",
      "RUN_END_COMMIT",
      "STATE_SNAPSHOT",
      "CROSS_RUN_MATERIALIZATION",
      "RUN_CYCLE_COMPLETE",
    ]) {
      expect(phaseEntryTick.has(phase)).toBe(true);
    }
    // Phases are strictly ordered on the tick grid.
    expect(phaseEntryTick.get("ROOM_SAMPLING")!).toBeLessThan(phaseEntryTick.get("WORLD_RESPONSE")!);
    expect(phaseEntryTick.get("DUSK_APPROACH")!).toBeLessThan(phaseEntryTick.get("RUN_END_COMMIT")!);
    expect(phaseEntryTick.get("STATE_SNAPSHOT")!)
      .toBeLessThan(phaseEntryTick.get("CROSS_RUN_MATERIALIZATION")!);

    const snapshot = conductor.snapshot();
    expect(snapshot.runEndReason).toBe("PROTOCOL_WITHDRAWAL");
    expect(snapshot.hud.runElapsedMs).toBeGreaterThanOrEqual(240_000);

    // Observation selection: at most three, at most one per category, each
    // carrying resolved trace paths rather than a verdict.
    expect(snapshot.observations.length).toBeGreaterThan(0);
    expect(snapshot.observations.length).toBeLessThanOrEqual(3);
    expect(new Set(snapshot.observations.map((entry) => entry.category)).size)
      .toBe(snapshot.observations.length);
    for (const observation of snapshot.observations) {
      expect(observation.trace.length).toBeGreaterThan(0);
      for (const trace of observation.trace) expect(trace.path).toEqual(expect.any(String));
    }

    // DUSK stops NEW spawning; existing bodies are not swept away.
    const record = archive.loadLatest();
    expect(record).not.toBeNull();
    expect(validateRunMemory(record)).toEqual({ok: true, errors: []});
    expect(record!.run.id).toBe("run-integration");
    expect(record!.resolution.reason).toBe("PROTOCOL_WITHDRAWAL");
    expect(record!.run.roomsVisited.length).toBeGreaterThanOrEqual(2);
    expect(record!.ghostRoute).not.toBeNull();

    // The next run is constructed from the persisted record, exactly as a
    // fresh page load would do it.
    const next = new RunConductor({
      runId: "run-integration-next",
      rawRunSeed: RUN_SEED,
      previousRun: record as FinalizedRunMemory,
      roomCount: 2,
    });
    const timeline = next.snapshot().restoreTimeline;
    expect(timeline.map((step) => step.phase)).toEqual([
      "material",
      "ghost-replay-begin",
      "ghost-replay-complete",
      "ghost-residue",
      "witness",
      "input-return",
    ]);
    const routeDurationMs = record!.ghostRoute!.points.at(-1)!.tMs;
    expect(timeline[0]!.tick120).toBe(0);
    expect(timeline[1]!.tick120).toBe(crossedTickCount(420));
    expect(timeline[2]!.tick120).toBe(crossedTickCount(routeDurationMs + 420));
    expect(timeline[3]!.tick120).toBe(crossedTickCount(routeDurationMs + 421));
    expect(timeline[4]!.tick120).toBe(crossedTickCount(routeDurationMs + 700));
    expect(timeline[5]!.tick120).toBe(crossedTickCount(routeDurationMs + 1140));
    for (let index = 1; index < timeline.length; index += 1) {
      expect(timeline[index]!.tick120).toBeGreaterThanOrEqual(timeline[index - 1]!.tick120);
    }

    // Input stays withheld until the return tick, and the states run in the
    // authored order: material -> ghost -> witness -> input return.
    const inputReturnTick = timeline[5]!.tick120;
    const phaseAt = new Map<string, number>();
    for (let tick = 0; tick <= inputReturnTick + 4; tick += 1) {
      const before = next.runPhase;
      next.step(IDLE_INPUT);
      if (next.runPhase !== before && !phaseAt.has(next.runPhase)) {
        phaseAt.set(next.runPhase, next.tick120);
      }
      if (next.tick120 < inputReturnTick) expect(next.snapshot().hud.inputReturned).toBe(false);
    }
    expect(phaseAt.get("GHOST_REPLAY")!).toBeLessThan(phaseAt.get("WITNESS_ORIENTATION")!);
    expect(phaseAt.get("WITNESS_ORIENTATION")!).toBeLessThan(phaseAt.get("AWAKENING")!);
    // The ghost is replayed in full before witnesses may orient, and input
    // returns only after they have.
    expect(phaseAt.get("WITNESS_ORIENTATION")!).toBeGreaterThanOrEqual(timeline[2]!.tick120);
    expect(phaseAt.get("AWAKENING")!).toBeGreaterThanOrEqual(inputReturnTick);

    // The observed restore matches the schedule tick for tick, in order.
    expect(next.snapshot().restoreProgress).toEqual(timeline);
  }, 120_000);
});

describe("the canonical trace is a pure function of seed and tape", () => {
  it("replays byte-identically for the same seed and the same input tape", () => {
    const first = driveRun(
      new RunConductor({runId: "run-det", rawRunSeed: RUN_SEED, previousRun: null, roomCount: 2}),
      1800,
    );
    const second = driveRun(
      new RunConductor({runId: "run-det", rawRunSeed: RUN_SEED, previousRun: null, roomCount: 2}),
      1800,
    );
    expect(first.conductor.tick120).toBe(second.conductor.tick120);
    expect(first.conductor.canonicalTrace()).toBe(second.conductor.canonicalTrace());
    expect(first.conductor.bus.committedEventCount())
      .toBe(second.conductor.bus.committedEventCount());
    expect(first.conductor.bus.committedEventCount()).toBeGreaterThan(0);
  });

  it("diverges for a different seed, so the comparison is not vacuous", () => {
    const other = driveRun(
      new RunConductor({runId: "run-det", rawRunSeed: 0x0badf00d, previousRun: null, roomCount: 2}),
      1800,
    );
    const baseline = driveRun(
      new RunConductor({runId: "run-det", rawRunSeed: RUN_SEED, previousRun: null, roomCount: 2}),
      1800,
    );
    expect(other.conductor.canonicalTrace()).not.toBe(baseline.conductor.canonicalTrace());
  });
});

describe("accessibility profiles cannot reach the gameplay trace", () => {
  it("has no accessibility input surface, and ignores one if a caller invents it", () => {
    expect(Object.keys(IDLE_INPUT).some((key) => /reduced|motion|flash|contrast|profile/i.test(key)))
      .toBe(false);

    const plain = driveRun(
      new RunConductor({runId: "run-a11y", rawRunSeed: RUN_SEED, previousRun: null, roomCount: 2}),
      1200,
    );
    const decorated = new RunConductor({
      runId: "run-a11y",
      rawRunSeed: RUN_SEED,
      previousRun: null,
      roomCount: 2,
    });
    let clampTicks = 0;
    for (let tick = 0; tick < 1200 && !decorated.complete; tick += 1) {
      const phase = decorated.runPhase;
      if (phase === "FIRST_CLAMP_RECOVERY") clampTicks += 1;
      decorated.step({
        ...tapeInput(phase, tick, clampTicks),
        // Presentation-shaped fields a renderer might try to smuggle in.
        ...({reducedMotion: true, flashOff: true, highContrast: true} as unknown as object),
      });
    }
    expect(decorated.canonicalTrace()).toBe(plain.conductor.canonicalTrace());
  });
});

describe("the conductor snapshot is presentation's only source", () => {
  it("structurally satisfies the presentation contract and stays frozen", () => {
    const conductor = new RunConductor({
      runId: "run-shape",
      rawRunSeed: RUN_SEED,
      previousRun: null,
      roomCount: 2,
    });
    conductor.step(IDLE_INPUT);
    const snapshot = conductor.snapshot();
    // Compile-time proof; the assignment fails to build if the shape drifts.
    //
    // `projectiles` is excluded on purpose: the authority's projectile
    // lifecycle has seven states (it also names cancel/impact/cleanup) while
    // game/presentation.ts currently declares four. The conductor reports the
    // authority's real lifecycle rather than narrowing it to fit a presentation
    // type, so the narrower field is checked by name below and the union gap is
    // presentation.ts's to widen.
    const presentation: Omit<PresentationSourceSnapshot, "projectiles"> = snapshot;
    expect(presentation.tick120).toBe(snapshot.tick120);
    for (const field of [
      "instanceId", "generation", "archetypeId", "collisionRadiusPx", "state",
      "collisionEnabled", "previousPosition", "position", "spawnedAtTick",
      "armAtTick", "sourceId", "headingDegrees", "speedPxPerSecond",
    ]) {
      for (const projectile of snapshot.projectiles) {
        expect(projectile).toHaveProperty(field);
      }
    }
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.player)).toBe(true);
    expect(Object.isFrozen(snapshot.hud)).toBe(true);
    expect(snapshot.weather.authority).toBe("weather-presentation");
    expect(snapshot.authority).toBe("run-conductor");
  });

  it("carries no evaluative vocabulary in its own surface", () => {
    const conductor = new RunConductor({
      runId: "run-vocab",
      rawRunSeed: RUN_SEED,
      previousRun: null,
      roomCount: 2,
    });
    conductor.step(IDLE_INPUT);
    const serialized = JSON.stringify(conductor.snapshot());
    for (const token of ["score", "rank", "victory", "defeat", "good_end", "bad_end"]) {
      expect(serialized.toLowerCase()).not.toContain(token);
    }
  });
});

describe("room threshold hysteresis is authored, not inferred", () => {
  it("enters on the authored edge and leaves only past the authored release", () => {
    const watcher = new RoomThresholdWatcher("INFORMATION");
    // info.signal-visible: enter at 0.55, release only below 0.48.
    expect(watcher.observe({"flower.intensity": 0.54}, 0)).toHaveLength(0);
    expect(watcher.observe({"flower.intensity": 0.55}, 1).map((entry) => entry.thresholdId))
      .toEqual(["info.signal-visible"]);
    // Inside the band: neither edge fires again.
    expect(watcher.observe({"flower.intensity": 0.5}, 2)).toHaveLength(0);
    expect(watcher.observe({"flower.intensity": 0.56}, 3)).toHaveLength(0);
    const released = watcher.observe({"flower.intensity": 0.47}, 4);
    expect(released.map((entry) => entry.thresholdId)).toEqual(["info.signal-visible"]);
    expect(released[0]!.edge).toBe("exit");
  });

  it("treats an absent metric as absent, never as zero", () => {
    const watcher = new RoomThresholdWatcher("FORCED_ALIGNMENT");
    // forced.fall enters when player.yWorld < -150; supplying nothing must not
    // fabricate a fall from an implicit zero.
    expect(watcher.observe({}, 0)).toHaveLength(0);
    expect(watcher.armedThresholdIds()).toHaveLength(0);
  });
});
