import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

import uiLayoutsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ui-layouts-v4.json";
import uiCopyManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ui-copy-v4.json";
import type {ConductorSnapshot} from "../authority/conductor";
import type {FinalizedRunMemory} from "../authority/run-memory-model";
import {
  GAZE_STATE_ORDER,
  HUD_BIND_PATHS,
  HUD_CONDITION_EXPRESSIONS,
  HudView,
  UI_ACTION_IDS,
  UI_COPY_KEYS,
  UI_CROSS_RUN_TRANSITION_TIMELINE,
  UI_DISCOVERY_PROMPTS,
  UI_FORBIDDEN_TOKENS,
  UI_LAYOUT_COMMON,
  UI_LAYOUT_SCREENS,
  formatBindValue,
  hudElementId,
  integerPixelScale,
  layerOf,
  projectDiscoveryPrompts,
  projectHudScreen,
  promptElementId,
  rectWithinSafeArea,
  resolveHudBind,
  resolveHudCondition,
  scaleLayerRect,
  uiActionCopy,
  uiCopy,
  type HudBindValue,
  type HudSource,
  type HudWritableElement,
} from "./hud";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A real ConductorSnapshot shape; the HudSnapshot Pick must accept it whole. */
function conductorSnapshotFixture(
  overrides: Partial<ConductorSnapshot> = {},
): ConductorSnapshot {
  const base: ConductorSnapshot = {
    tick120: 7200,
    relativeTick120: 240,
    patternId: "common.eye_acquisition",
    roomId: "FORCED_ALIGNMENT",
    difficulty: "NORMAL",
    projectiles: [],
    combatEnabled: true,
    targetVisible: true,
    player: {
      position: {x: 180, y: 520},
      focused: false,
      damage: {state: "alive", health: 1, lives: 3, collisionEnabled: true},
      evidence: 4,
      expression: 0.5,
    },
    gazeState: "clamped",
    gazeClampReleased: false,
    localVoid: null,
    authority: "run-conductor",
    runId: "run-fixture",
    runPhase: "MENTAL_ROOM",
    inputPolicy: "full",
    runComplete: false,
    visitedRooms: ["INFORMATION", "FORCED_ALIGNMENT"],
    weather: {
      phase: "omen",
      classId: "RAIN",
      biasView: {},
      residues: [],
      witnessFacePlayerException: false,
      authority: "weather-presentation",
    },
    hud: {
      inputPolicy: "full",
      inputReturned: true,
      flowerIntensity: 0.62,
      evidenceAvailable: 4,
      gazeTotalMs: 8400,
      flowerForcedDimCount: 1,
      overrideEligible: true,
      overrideActive: false,
      distinctRoomsVisited: 2,
      runElapsedMs: 61_000,
    },
    observations: [
      {
        id: "observation.gaze-held",
        category: "gaze",
        zhCN: "你在同一处读了很久。",
        en: "YOU READ ONE PLACE FOR A LONG TIME.",
        trace: [
          {path: "metrics.gazeRatio", value: 0.41},
          {path: "metrics.gazeClampCount", value: 3},
        ],
      },
      {
        id: "observation.route-narrow",
        category: "route",
        zhCN: "路线一直贴着同一侧。",
        en: "THE ROUTE STAYED ON ONE SIDE.",
        trace: [{path: "metrics.routeWidth", value: 0.18}],
      },
      {
        id: "observation.override-local",
        category: "override",
        zhCN: "规则只在一处被撕开。",
        en: "THE RULE WAS TORN IN ONE PLACE ONLY.",
        trace: [{path: "metrics.overrideCount", value: 1}],
      },
      {
        id: "observation.excess",
        category: "weather",
        zhCN: "第四句不应出现。",
        en: "A FOURTH LINE MUST NOT APPEAR.",
        trace: [{path: "metrics.weatherExposure", value: 2}],
      },
    ],
    runEndReason: null,
    restoreTimeline: [],
    restoreProgress: [],
    entryOmens: [],
    thresholdFacts: [],
    withheldEncounters: [],
    narrativeLog: [],
    ...overrides,
  };
  return Object.freeze(base);
}

function finalizedFixture(): FinalizedRunMemory {
  return {
    schemaVersion: "4.0.0-run-memory",
    run: {
      id: "run-fixture",
      seed: 424242,
      startedAtTick: 0,
      endedAtTick: 28_800,
      durationMs: 240_000,
      roomsVisited: ["INFORMATION", "FORCED_ALIGNMENT"],
    },
    metrics: {},
    resolution: {reason: "PROTOCOL_WITHDRAWAL", bossId: null, factEventId: "run.resolution"},
    fingerprint: {
      seed: 424242,
      generator: "v4-fingerprint",
      digestSha256: "a".repeat(64),
      bitDepth: 1,
    },
    materialMemory: {
      overrideScars: [{id: "scar-1"}],
      deathTraces: [
        {id: "trace-1", createdAtTick: 900, causeArchetype: "common.dense_wall"},
        {id: "trace-2", createdAtTick: 5400, causeArchetype: "room.mirror_lane"},
      ],
      burnIns: [{id: "burn-1"}],
      ghostResidues: [],
    },
    ghostRoute: null,
    witnessMemory: [],
    rehydrationOrder: [],
  } as unknown as FinalizedRunMemory;
}

function sourceFixture(overrides: Partial<HudSource> = {}): HudSource {
  return {
    snapshot: conductorSnapshotFixture(),
    discovery: {
      signalInputCount: 0,
      horizonVisible: true,
      gazeThresholdCrossed: false,
      tracePanelOpened: false,
      hasEncounteredConditionComponent: false,
      snapshotOpen: false,
    },
    accessibility: {reducedMotion: false, flashingOff: false, audioDescriptions: false},
    finalized: null,
    previousRun: null,
    boss: null,
    expandedObservationIds: [],
    ...overrides,
  };
}

function fakeElement(): HudWritableElement & {readonly properties: Record<string, string>} {
  const properties: Record<string, string> = {};
  return {
    textContent: null,
    hidden: false,
    dataset: {},
    properties,
    style: {
      setProperty(property: string, value: string): void {
        properties[property] = value;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest ingestion
// ---------------------------------------------------------------------------

describe("ui-layouts-v4 ingestion", () => {
  it("carries the authored canvas contract", () => {
    expect(UI_LAYOUT_COMMON.logicalCanvas).toEqual([360, 640]);
    expect(UI_LAYOUT_COMMON.safeArea).toEqual({x: 12, y: 8, w: 336, h: 620});
    expect(UI_LAYOUT_COMMON.pixelScale).toBe("integer-only");
    expect(UI_LAYOUT_COMMON.typeface).toBe("Noto Sans SC Variable");
    expect(UI_LAYOUT_COMMON.dataAuthority).toBe("runMemoryV4");
  });

  it("parses every authored screen and layer", () => {
    expect(Object.keys(UI_LAYOUT_SCREENS).sort()).toEqual(
      Object.keys(uiLayoutsManifest.screens).sort(),
    );
    expect(UI_LAYOUT_SCREENS.gameplay_hud?.layers.map((layer) => layer.id)).toEqual([
      "flower",
      "gaze",
      "evidence",
      "memory",
      "room",
      "weather",
    ]);
    expect(UI_LAYOUT_SCREENS.boss_hud?.layers).toHaveLength(4);
    expect(UI_LAYOUT_SCREENS.state_snapshot?.layers).toHaveLength(5);
    expect(UI_LAYOUT_SCREENS.failure?.layers).toHaveLength(3);
  });

  it("speaks the renamed run_interruption semantic instead of the manifest key", () => {
    expect(UI_LAYOUT_SCREENS.failure?.semanticId).toBe("run_interruption");
    expect(hudElementId("failure", "interruption_fact")).toBe(
      "hud-run-interruption-interruption-fact",
    );
    expect(hudElementId("gameplay_hud", "flower")).toBe("hud-gameplay-hud-flower");
  });

  it("keeps every authored gameplay rect inside the authored safe area", () => {
    for (const layer of UI_LAYOUT_SCREENS.gameplay_hud?.layers ?? []) {
      expect(layer.rect).not.toBeNull();
      expect(rectWithinSafeArea(layer.rect!)).toBe(true);
    }
  });

  it("keeps the authored cross-run restore timeline in order and complete", () => {
    expect(UI_CROSS_RUN_TRANSITION_TIMELINE.map((step) => step.event)).toEqual([
      "overrideScar.rehydrate",
      "deathTrace.rehydrate",
      "burnIn.rehydrate",
      "ghost.replay.begin",
      "ghost.replay.complete",
      "ghost.residue.write",
      "witness.turn",
      "returnInput",
    ]);
  });

  it("exposes the four authored discovery prompts", () => {
    expect(UI_DISCOVERY_PROMPTS.map((prompt) => prompt.id)).toEqual([
      "signal-fallback",
      "gaze-threshold",
      "override",
      "snapshot-trace",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Bind + condition coverage
// ---------------------------------------------------------------------------

function authoredBindPaths(): readonly string[] {
  const paths = new Set<string>();
  for (const screen of Object.values(UI_LAYOUT_SCREENS)) {
    for (const layer of screen.layers) paths.add(layer.bind);
  }
  return [...paths];
}

function authoredConditionExpressions(): readonly string[] {
  const expressions = new Set<string>();
  for (const screen of Object.values(UI_LAYOUT_SCREENS)) {
    for (const layer of screen.layers) {
      if (layer.visibility !== null) expressions.add(layer.visibility);
    }
  }
  for (const prompt of UI_DISCOVERY_PROMPTS) expressions.add(prompt.guard);
  return [...expressions];
}

describe("bind expression coverage", () => {
  it("resolves every authored bind expression against a conductor snapshot", () => {
    const source = sourceFixture({finalized: finalizedFixture(), previousRun: finalizedFixture()});
    for (const bind of authoredBindPaths()) {
      const value: HudBindValue = resolveHudBind(bind, source);
      expect(value.kind, `bind ${bind}`).toBeTypeOf("string");
    }
  });

  it("has no resolver without an authored bind and no authored bind without a resolver", () => {
    expect([...HUD_BIND_PATHS].sort()).toEqual([...authoredBindPaths()].sort());
  });

  it("fails closed on an unauthored bind path", () => {
    expect(() => resolveHudBind("run.totalPoints", sourceFixture())).toThrow(
      /no HUD resolver for bind expression/,
    );
  });

  it("resolves every authored visibility and prompt guard expression", () => {
    const source = sourceFixture();
    for (const expression of authoredConditionExpressions()) {
      expect(typeof resolveHudCondition(expression, source), expression).toBe("boolean");
    }
    expect([...HUD_CONDITION_EXPRESSIONS].sort()).toEqual(
      [...authoredConditionExpressions()].sort(),
    );
  });

  it("fails closed on an unauthored condition expression", () => {
    expect(() => resolveHudCondition("player.isWinning", sourceFixture())).toThrow(
      /no HUD resolver for condition expression/,
    );
  });
});

// ---------------------------------------------------------------------------
// Individual binds
// ---------------------------------------------------------------------------

describe("gameplay HUD binds", () => {
  it("projects flower intensity as the authority's own meter value", () => {
    expect(resolveHudBind("player.flowerIntensity", sourceFixture())).toEqual({
      kind: "meter",
      value: 0.62,
    });
  });

  it("projects gaze pressure as the authority's own state, never an invented magnitude", () => {
    expect(resolveHudBind("player.gazePressure", sourceFixture())).toEqual({
      kind: "state",
      stateId: "clamped",
      order: GAZE_STATE_ORDER.indexOf("clamped"),
      ofOrder: GAZE_STATE_ORDER.length,
    });
  });

  it("projects graze evidence as available facts, not as spendable currency", () => {
    expect(resolveHudBind("player.grazeEvidenceAvailable", sourceFixture())).toEqual({
      kind: "count",
      value: 4,
    });
  });

  it("counts material memory across every authored group", () => {
    const source = sourceFixture({previousRun: finalizedFixture()});
    expect(resolveHudBind("run.materialMemoryCount", source)).toEqual({kind: "count", value: 4});
  });

  it("reports zero material memory on a null-route boot", () => {
    expect(resolveHudBind("run.materialMemoryCount", sourceFixture())).toEqual({
      kind: "count",
      value: 0,
    });
  });

  it("projects the canonical room id verbatim", () => {
    expect(resolveHudBind("room.id", sourceFixture())).toEqual({
      kind: "token",
      value: "FORCED_ALIGNMENT",
    });
  });

  it("labels the weather omen from authored copy", () => {
    expect(resolveHudBind("weather.phaseLabel", sourceFixture())).toEqual({
      kind: "text",
      text: uiCopy("weather.RAIN.OMEN"),
      copyKey: "weather.RAIN.OMEN",
    });
  });

  it("stays silent in weather phases the copy manifest does not author", () => {
    const source = sourceFixture({
      snapshot: conductorSnapshotFixture({
        weather: {
          phase: "aftermath",
          classId: "RAIN",
          biasView: {},
          residues: [],
          witnessFacePlayerException: false,
          authority: "weather-presentation",
        },
      }),
    });
    expect(resolveHudBind("weather.phaseLabel", source).kind).toBe("absent");
  });

  it("hides the weather layer only while the phase rests and audio description is off", () => {
    const idle = sourceFixture({
      snapshot: conductorSnapshotFixture({
        weather: {
          phase: "idle",
          classId: null,
          biasView: {},
          residues: [],
          witnessFacePlayerException: false,
          authority: "weather-presentation",
        },
      }),
    });
    const expression = layerOf("gameplay_hud", "weather").visibility!;
    expect(resolveHudCondition(expression, idle)).toBe(false);
    expect(
      resolveHudCondition(expression, {
        ...idle,
        accessibility: {...idle.accessibility, audioDescriptions: true},
      }),
    ).toBe(true);
    expect(resolveHudCondition(expression, sourceFixture())).toBe(true);
  });
});

describe("boss HUD binds", () => {
  it("stays absent while no boss protocol is present", () => {
    const source = sourceFixture();
    for (const layer of UI_LAYOUT_SCREENS.boss_hud?.layers ?? []) {
      expect(resolveHudBind(layer.bind, source).kind, layer.id).toBe("absent");
    }
  });

  it("projects protocolRemaining as an interval, never as a life value", () => {
    const source = sourceFixture({
      boss: {
        localizedName: {zhCN: "缺席的接收者", en: "ABSENT RECEIVER"},
        protocolRemaining: {kind: "interval", remainingMs: 18_000, totalMs: 45_000},
        currentReadingFact: null,
        discoveredResolutionHint: null,
      },
    });
    const value = resolveHudBind("boss.protocolRemaining", source);
    expect(value).toEqual({kind: "interval", remainingMs: 18_000, totalMs: 45_000});
    expect(JSON.stringify(value)).not.toMatch(/health|hp|life|lives/i);
    expect(layerOf("boss_hud", "protocol_interval").semantic).toBe("time-or-structure-not-life");
  });

  it("projects protocolRemaining as read structure when the rig resolves structurally", () => {
    const source = sourceFixture({
      boss: {
        localizedName: {zhCN: "缺席的接收者", en: "ABSENT RECEIVER"},
        protocolRemaining: {kind: "structure", resolved: 2, total: 3},
        currentReadingFact: {zhCN: "它在等待一次不回应", en: "IT AWAITS ONE NON-REPLY"},
        discoveredResolutionHint: null,
      },
    });
    expect(resolveHudBind("boss.protocolRemaining", source)).toEqual({
      kind: "structure",
      resolved: 2,
      total: 3,
    });
    expect(resolveHudBind("boss.discoveredResolutionHint", source).kind).toBe("absent");
  });
});

// ---------------------------------------------------------------------------
// Snapshot screen
// ---------------------------------------------------------------------------

describe("state snapshot screen", () => {
  it("renders at most the authored three observation lines", () => {
    const value = resolveHudBind("snapshot.observationsLocalized", sourceFixture());
    expect(value.kind).toBe("observations");
    if (value.kind !== "observations") throw new Error("expected observations");
    expect(value.items).toHaveLength(3);
    expect(value.items.map((item) => item.id)).not.toContain("observation.excess");
    expect(value.items[0]?.text).toEqual({
      zhCN: "你在同一处读了很久。",
      en: "YOU READ ONE PLACE FOR A LONG TIME.",
    });
    expect(layerOf("state_snapshot", "observations").maximumLines).toBe(3);
  });

  it("shows no traces until an observation is expanded", () => {
    const value = resolveHudBind("snapshot.selectedObservationTraces", sourceFixture());
    if (value.kind !== "traces") throw new Error("expected traces");
    expect(value.items).toEqual([]);
  });

  it("renders each expanded observation with its authority trace metric paths", () => {
    const source = sourceFixture({expandedObservationIds: ["observation.gaze-held"]});
    const value = resolveHudBind("snapshot.selectedObservationTraces", source);
    if (value.kind !== "traces") throw new Error("expected traces");
    expect(value.items).toEqual([
      {observationId: "observation.gaze-held", path: "metrics.gazeRatio", value: "0.41"},
      {observationId: "observation.gaze-held", path: "metrics.gazeClampCount", value: "3"},
    ]);
    expect(layerOf("state_snapshot", "fact_traces").interaction).toBe("expand-only");
  });

  it("marks expanded observations and keeps expansion expand-only", () => {
    const view = new HudView({getElementById: () => null});
    view.expandObservation("observation.route-narrow");
    view.expandObservation("observation.route-narrow");
    expect(view.expandedObservationIds).toEqual(["observation.route-narrow"]);
    const value = resolveHudBind(
      "snapshot.observationsLocalized",
      sourceFixture({expandedObservationIds: view.expandedObservationIds}),
    );
    if (value.kind !== "observations") throw new Error("expected observations");
    expect(value.items.filter((item) => item.expanded).map((item) => item.id)).toEqual([
      "observation.route-narrow",
    ]);
  });

  it("groups material memory exactly as the manifest authors the groups", () => {
    const source = sourceFixture({finalized: finalizedFixture()});
    const value = resolveHudBind("run.materialMemory", source);
    if (value.kind !== "material") throw new Error("expected material");
    expect(value.groups.map((group) => group.group)).toEqual(
      layerOf("state_snapshot", "material_memory").groups,
    );
    expect(value.groups.map((group) => group.count)).toEqual([1, 2, 1, 0]);
  });

  it("projects the run fingerprint as a 1-bit authority fact", () => {
    const value = resolveHudBind("run.fingerprintBitmap", sourceFixture({
      finalized: finalizedFixture(),
    }));
    expect(value).toEqual({
      kind: "fingerprint",
      seed: 424242,
      digestSha256: "a".repeat(64),
      bitDepth: 1,
    });
    expect(layerOf("state_snapshot", "fingerprint").format).toBe("1-bit");
  });

  it("keeps the fingerprint absent before the run is serialized", () => {
    expect(resolveHudBind("run.fingerprintBitmap", sourceFixture()).kind).toBe("absent");
  });

  it("localizes an authored resolution and leaves an unauthored one a bare fact", () => {
    const withdrawal = sourceFixture({finalized: finalizedFixture()});
    expect(resolveHudBind("run.resolution.factLocalized", withdrawal)).toEqual({
      kind: "text",
      text: uiCopy("resolution.protocolWithdrawal"),
      copyKey: "resolution.protocolWithdrawal",
    });

    const unauthored = sourceFixture({
      snapshot: conductorSnapshotFixture({runEndReason: "QUEUE_EXHAUSTED", runComplete: true}),
    });
    expect(resolveHudBind("run.resolution.factLocalized", unauthored)).toEqual({
      kind: "token",
      value: "QUEUE_EXHAUSTED",
    });
  });
});

describe("run interruption screen", () => {
  it("reads the same state as the snapshot screen and names no judgement", () => {
    const source = sourceFixture({finalized: finalizedFixture()});
    const model = projectHudScreen("failure", source);
    expect(model.layers.map((layer) => layer.id)).toEqual([
      "interruption_fact",
      "death_trace",
      "fingerprint",
    ]);
    const deathTrace = model.layers.find((layer) => layer.id === "death_trace")?.value;
    expect(deathTrace).toEqual({
      kind: "materialItem",
      group: "deathTraces",
      id: "trace-2",
      createdAtTick: 5400,
      detail: "room.mirror_lane",
    });
    expect(UI_LAYOUT_SCREENS.failure?.actions).toEqual([
      "openSnapshot",
      "continueWithMemory",
      "title",
    ]);
  });

  it("keeps the body trace absent when the route left none", () => {
    expect(resolveHudBind("run.materialMemory.deathTraces.last", sourceFixture()).kind).toBe(
      "absent",
    );
  });
});

// ---------------------------------------------------------------------------
// Discovery prompts
// ---------------------------------------------------------------------------

describe("discovery prompts replace tutorials", () => {
  it("shows the flower fallback only after the authored 60s with no signal input", () => {
    const prompts = projectDiscoveryPrompts(sourceFixture());
    const fallback = prompts.find((prompt) => prompt.id === "signal-fallback");
    expect(fallback?.visible).toBe(true);
    expect(fallback?.text).toEqual(uiCopy("prompt.signal"));

    const early = sourceFixture({
      snapshot: conductorSnapshotFixture({
        hud: {...conductorSnapshotFixture().hud, runElapsedMs: 59_999},
      }),
    });
    expect(
      projectDiscoveryPrompts(early).find((prompt) => prompt.id === "signal-fallback")?.visible,
    ).toBe(false);
  });

  it("withdraws the flower fallback once the player has signalled", () => {
    const signalled = sourceFixture({
      discovery: {...sourceFixture().discovery, signalInputCount: 1},
    });
    expect(
      projectDiscoveryPrompts(signalled).find((prompt) => prompt.id === "signal-fallback")?.visible,
    ).toBe(false);
  });

  it("keeps the gaze threshold prompt purely visual, with no authored copy", () => {
    const prompt = projectDiscoveryPrompts(sourceFixture()).find(
      (entry) => entry.id === "gaze-threshold",
    );
    expect(prompt?.visible).toBe(true);
    expect(prompt?.text).toBeNull();
    expect(prompt?.visual).toBe("one-pixel horizon threshold pulse");
  });

  it("shows the override prompt only while the authority reports eligibility", () => {
    expect(
      projectDiscoveryPrompts(sourceFixture()).find((prompt) => prompt.id === "override")?.visible,
    ).toBe(true);
    const ineligible = sourceFixture({
      snapshot: conductorSnapshotFixture({
        hud: {...conductorSnapshotFixture().hud, overrideEligible: false},
      }),
    });
    expect(
      projectDiscoveryPrompts(ineligible).find((prompt) => prompt.id === "override")?.visible,
    ).toBe(false);
  });

  it("shows the trace prompt only on an open snapshot with an unopened panel", () => {
    const open = sourceFixture({
      discovery: {...sourceFixture().discovery, snapshotOpen: true},
    });
    expect(
      projectDiscoveryPrompts(open).find((prompt) => prompt.id === "snapshot-trace")?.visible,
    ).toBe(true);
    const opened = sourceFixture({
      discovery: {...sourceFixture().discovery, snapshotOpen: true, tracePanelOpened: true},
    });
    expect(
      projectDiscoveryPrompts(opened).find((prompt) => prompt.id === "snapshot-trace")?.visible,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe("ui-copy-v4", () => {
  it("resolves every authored key bilingually", () => {
    expect(UI_COPY_KEYS).toEqual(Object.keys(uiCopyManifest.copy));
    for (const key of UI_COPY_KEYS) {
      const text = uiCopy(key);
      expect(text.zhCN.length, key).toBeGreaterThan(0);
      expect(text.en.length, key).toBeGreaterThan(0);
    }
  });

  it("resolves every labelCopy and prompt copy key the layout manifest references", () => {
    for (const screen of Object.values(UI_LAYOUT_SCREENS)) {
      for (const layer of screen.layers) {
        if (layer.labelCopy !== null) expect(() => uiCopy(layer.labelCopy!)).not.toThrow();
      }
    }
    for (const prompt of UI_DISCOVERY_PROMPTS) {
      if (prompt.copyKey !== null) expect(() => uiCopy(prompt.copyKey!)).not.toThrow();
    }
    expect(() => uiCopy("continue.note")).not.toThrow();
  });

  it("fails closed on an unauthored copy key", () => {
    expect(() => uiCopy("hud.totalPoints")).toThrow(/does not author the key/);
  });

  it("gives every authored screen action either authored copy or authored silence", () => {
    const actions = new Set<string>();
    for (const screen of Object.values(UI_LAYOUT_SCREENS)) {
      for (const action of screen.actions) actions.add(action);
    }
    for (const action of ["continueWithMemory", "newRunWithoutMemory"]) actions.add(action);
    expect([...actions].sort()).toEqual([...UI_ACTION_IDS].sort());
    expect(uiActionCopy("continueWithMemory")).toEqual(uiCopy("continue.withMemory"));
    expect(uiActionCopy("title")).toEqual(uiCopy("continue.withoutMemory"));
    // No authored sentence exists for the export action; none is invented.
    expect(uiActionCopy("exportPng")).toBeNull();
    expect(() => uiActionCopy("submitToLadder")).toThrow(/does not author the action/);
  });
});

// ---------------------------------------------------------------------------
// Forbidden vocabulary lint
// ---------------------------------------------------------------------------

const LINTED_FILES = ["../../index.html", "../style.css", "./hud.ts"] as const;

/**
 * The manifest's own list, plus the repository contract's banned judgement
 * vocabulary. A run ends in observation and handoff, never in a verdict.
 */
const CONTRACT_TOKENS = [
  "leaderboard",
  "combo",
  "victory",
  "defeat",
  "good ending",
  "bad ending",
  "goodEnding",
  "badEnding",
  "胜利",
  "战败",
] as const;

function lintTokens(): readonly string[] {
  return [
    ...UI_FORBIDDEN_TOKENS,
    ...UI_LAYOUT_COMMON.forbiddenSemantics,
    ...CONTRACT_TOKENS,
  ].map((token) => token.toLowerCase());
}

describe("forbidden vocabulary", () => {
  it("keeps the manifest's own banned list non-empty", () => {
    expect(UI_FORBIDDEN_TOKENS.length).toBeGreaterThan(0);
    expect(UI_FORBIDDEN_TOKENS).toContain("score");
    expect(UI_LAYOUT_COMMON.forbiddenSemantics).toContain("comboRank");
  });

  it.each(LINTED_FILES)("keeps %s free of every banned token", (relativePath) => {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    const contents = readFileSync(path, "utf8").toLowerCase();
    for (const token of lintTokens()) {
      expect(contents.includes(token), `${relativePath} contains "${token}"`).toBe(false);
    }
  });

  it("keeps every resolved copy string free of every banned token", () => {
    for (const key of UI_COPY_KEYS) {
      const text = uiCopy(key);
      const haystack = `${key} ${text.zhCN} ${text.en}`.toLowerCase();
      for (const token of lintTokens()) {
        expect(haystack.includes(token), `${key} contains "${token}"`).toBe(false);
      }
    }
  });

  it("keeps every rendered HUD string free of every banned token", () => {
    const source = sourceFixture({
      finalized: finalizedFixture(),
      previousRun: finalizedFixture(),
      expandedObservationIds: ["observation.gaze-held"],
      boss: {
        localizedName: {zhCN: "缺席的接收者", en: "ABSENT RECEIVER"},
        protocolRemaining: {kind: "structure", resolved: 1, total: 3},
        currentReadingFact: {zhCN: "它在等待", en: "IT WAITS"},
        discoveredResolutionHint: {zhCN: "停止回应", en: "STOP REPLYING"},
      },
    });
    for (const screenId of Object.keys(UI_LAYOUT_SCREENS)) {
      if ((UI_LAYOUT_SCREENS[screenId]?.layers.length ?? 0) === 0) continue;
      for (const layer of projectHudScreen(screenId, source).layers) {
        const rendered = `${formatBindValue(layer.value, "zh-CN")} ${formatBindValue(
          layer.value,
          "en",
        )}`.toLowerCase();
        for (const token of lintTokens()) {
          expect(rendered.includes(token), `${screenId}.${layer.id} contains "${token}"`).toBe(
            false,
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Integer pixel scale
// ---------------------------------------------------------------------------

describe("integer-only pixel scale", () => {
  it("never produces a fractional scale", () => {
    for (const [width, height, expected] of [
      [360, 640, 1],
      [719, 1279, 1],
      [720, 1280, 2],
      [1100, 1930, 3],
      [10, 10, 1],
    ] as const) {
      expect(integerPixelScale(width, height), `${width}x${height}`).toBe(expected);
    }
  });

  it("scales authored rects to integer device rects", () => {
    expect(scaleLayerRect(layerOf("gameplay_hud", "flower").rect!, 3)).toEqual({
      leftPx: 36,
      topPx: 24,
      widthPx: 306,
      heightPx: 78,
    });
    expect(() => scaleLayerRect([0, 0, 8, 8], 1.5)).toThrow(/positive integer/);
  });
});

// ---------------------------------------------------------------------------
// DOM projection
// ---------------------------------------------------------------------------

describe("HudView", () => {
  it("writes every gameplay layer element and never reads gameplay back", () => {
    const elements = new Map<string, ReturnType<typeof fakeElement>>();
    for (const layer of UI_LAYOUT_SCREENS.gameplay_hud?.layers ?? []) {
      elements.set(hudElementId("gameplay_hud", layer.id), fakeElement());
    }
    const view = new HudView({getElementById: (id) => elements.get(id) ?? null});
    const source = sourceFixture();
    const model = view.renderScreen("gameplay_hud", source);

    expect(model.layers).toHaveLength(6);
    expect(elements.get("hud-gameplay-hud-room")?.textContent).toBe("FORCED_ALIGNMENT");
    expect(elements.get("hud-gameplay-hud-evidence")?.textContent).toBe("4");
    expect(elements.get("hud-gameplay-hud-flower")?.properties["--hud-meter"]).toBe("0.62");
    expect(elements.get("hud-gameplay-hud-gaze")?.dataset.stateId).toBe("clamped");
    // Geometry reaches CSS only as the authored logical rect.
    expect(elements.get("hud-gameplay-hud-flower")?.properties).toMatchObject({
      "--layer-x": "12",
      "--layer-y": "8",
      "--layer-w": "102",
      "--layer-h": "26",
    });
    expect(elements.get("hud-gameplay-hud-weather")?.textContent).toBe(
      uiCopy("weather.RAIN.OMEN").zhCN,
    );
    // The frozen snapshot is untouched: projection is one-directional.
    expect(Object.isFrozen(source.snapshot)).toBe(true);
  });

  it("hides an absent layer and writes no substitute text", () => {
    const element = fakeElement();
    const view = new HudView({
      getElementById: (id) => (id === hudElementId("boss_hud", "read_state") ? element : null),
    });
    view.renderScreen("boss_hud", sourceFixture());
    expect(element.hidden).toBe(true);
    expect(element.textContent).toBe("");
    expect(element.dataset.bindKind).toBe("absent");
  });

  it("writes the discovery prompt elements from the authored guards", () => {
    const elements = new Map<string, ReturnType<typeof fakeElement>>();
    for (const prompt of UI_DISCOVERY_PROMPTS) {
      elements.set(promptElementId(prompt.id), fakeElement());
    }
    const view = new HudView({getElementById: (id) => elements.get(id) ?? null});
    view.renderDiscoveryPrompts(sourceFixture());
    expect(elements.get("hud-prompt-signal-fallback")?.textContent).toBe(
      uiCopy("prompt.signal").zhCN,
    );
    expect(elements.get("hud-prompt-gaze-threshold")?.textContent).toBe("");
    expect(elements.get("hud-prompt-snapshot-trace")?.hidden).toBe(true);
  });

  it("renders english copy when the view is built for the en locale", () => {
    const element = fakeElement();
    const view = new HudView(
      {getElementById: (id) => (id === hudElementId("gameplay_hud", "weather") ? element : null)},
      {locale: "en"},
    );
    view.renderScreen("gameplay_hud", sourceFixture());
    expect(element.textContent).toBe(uiCopy("weather.RAIN.OMEN").en);
  });

  it("stamps only an integer stage scale", () => {
    const stage = fakeElement();
    const view = new HudView({getElementById: () => null});
    expect(view.applyStageScale(stage, 1100, 1930)).toBe(3);
    expect(stage.properties["--stage-scale"]).toBe("3");
    expect(stage.properties["--stage-width"]).toBe("1080px");
    expect(stage.properties["--stage-height"]).toBe("1920px");
    expect(stage.dataset.stageScale).toBe("3");
  });
});
