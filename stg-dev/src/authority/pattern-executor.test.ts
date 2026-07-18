import {beforeAll, describe, expect, it} from "vitest";
import determinismReportJson from "../../../1bit-stg-complete-asset-kit-v4/gameplay/reports/determinism-report-v4.json";
import safeGapReportJson from "../../../1bit-stg-complete-asset-kit-v4/gameplay/reports/safe-gap-report-v4.json";
import {
  EXECUTABLE_PATTERNS,
  LOGICAL_VIEW_HEIGHT,
  LOGICAL_VIEW_WIDTH,
  Mulberry32,
  compileDeclaredMotionStack,
  createPatternSchedule,
  executablePattern,
  geometryCandidates,
  pythonCanonicalTrace,
  reachablePath,
  safeGapCenter,
  simulatePattern,
  sweptCircleContainsPoint,
  sweptCirclePrimitive,
  type PatternTrace,
} from "./pattern-executor";

interface DeterminismRow {
  readonly patternId: string;
  readonly seed: number;
  readonly traceSha256: string;
  readonly repeatSha256: string;
  readonly pass: boolean;
  readonly emissionEvents: number;
  readonly gapInterventions: number;
  readonly splitChildren: number;
}

interface SafePathRow {
  readonly pass: boolean;
  readonly focus: boolean;
  readonly failedAtMs: number | null;
  readonly minimumClearancePx: number;
  readonly sampleCount: number;
  readonly pathHash: string;
}

interface SafeGapRow {
  readonly patternId: string;
  readonly normal: SafePathRow;
  readonly focus: SafePathRow;
  readonly pass: boolean;
}

const determinismRows = (determinismReportJson as {patterns: DeterminismRow[]}).patterns;
const safeGapRows = (safeGapReportJson as {patterns: SafeGapRow[]}).patterns;
const traces = new Map<string, PatternTrace>();

beforeAll(() => {
  for (const row of determinismRows) {
    traces.set(row.patternId, simulatePattern(row.patternId, {seed: row.seed}));
  }
}, 30_000);

describe("V4 pattern authority catalog", () => {
  it("uses the 48-pattern manifest as its only catalog and covers every authored geometry", () => {
    expect(EXECUTABLE_PATTERNS).toHaveLength(48);
    expect(new Set(EXECUTABLE_PATTERNS.map((pattern) => pattern.id)).size).toBe(48);
    expect([...new Set(EXECUTABLE_PATTERNS.flatMap((pattern) =>
      pattern.emitters.map((emitter) => emitter.geometry.type)))].sort()).toEqual([
      "arc",
      "broken_ring",
      "cross",
      "fan",
      "grid",
      "history_chain",
      "lattice",
      "line",
      "paired_fan",
      "ring",
      "shutter",
      "spiral",
      "wall",
    ]);
  });

  it("covers all 12 motion operators without inventing a parallel registry", () => {
    const used = new Set(EXECUTABLE_PATTERNS.flatMap((pattern) =>
      pattern.emitters.flatMap((emitter) => emitter.motionStack.map((motion) => motion.operator))));
    expect([...used].sort()).toEqual([
      "op.aim_lock",
      "op.dual_clock_gate",
      "op.history_replay",
      "op.lateral_wall",
      "op.limited_homing",
      "op.linear",
      "op.local_vector_bias",
      "op.orbit_release",
      "op.seam_transform",
      "op.speed_envelope",
      "op.split_generation",
      "op.turn_once",
    ]);
  });

  it("preserves declaration order and rejects an unknown operator", () => {
    const source = executablePattern("boss.misreader.phase3").emitters[0];
    expect(source).toBeDefined();
    const compiled = compileDeclaredMotionStack(source?.motionStack ?? []);
    expect(compiled.map((motion) => motion.operator)).toEqual(
      source?.motionStack.map((motion) => motion.operator),
    );
    expect(() => compileDeclaredMotionStack([
      {operator: "op.unowned_weather_motion", params: {}},
    ])).toThrow(/unknown operator/);
  });

  it("fails closed for an unknown pattern id", () => {
    expect(() => executablePattern("pattern.not-in-v4")).toThrow(/unknown V4 executable pattern/);
  });
});

describe("deterministic compilation primitives", () => {
  it("matches the Mulberry32-v1 reference stream", () => {
    const random = new Mulberry32(1);
    expect(Array.from({length: 5}, () => random.random())).toEqual([
      0.6270739405881613,
      0.002735721180215478,
      0.5274470399599522,
      0.9810509674716741,
      0.9683778982143849,
    ]);
  });

  it("sorts every cross-emitter cadence by time, emitter id, then burst index", () => {
    for (const pattern of EXECUTABLE_PATTERNS) {
      const schedule = createPatternSchedule(pattern, "NORMAL");
      for (let index = 1; index < schedule.length; index += 1) {
        const left = schedule[index - 1];
        const right = schedule[index];
        expect(left).toBeDefined();
        expect(right).toBeDefined();
        if (!left || !right) continue;
        const ordered = left.atMs < right.atMs
          || (left.atMs === right.atMs && left.emitter.id < right.emitter.id)
          || (left.atMs === right.atMs && left.emitter.id === right.emitter.id
            && left.burstIndex <= right.burstIndex);
        expect(ordered, `${pattern.id} schedule index ${index}`).toBe(true);
      }
    }
  });

  it("emits finite, ordered candidates for every authored geometry instance", () => {
    for (const pattern of EXECUTABLE_PATTERNS) {
      for (const emitter of pattern.emitters) {
        const candidates = geometryCandidates(emitter, 2, emitter.geometry.count);
        expect(candidates).toHaveLength(emitter.geometry.count);
        candidates.forEach((candidate, index) => {
          expect(candidate.sourceIndex).toBe(index);
          expect(Number.isFinite(candidate.x)).toBe(true);
          expect(Number.isFinite(candidate.y)).toBe(true);
          expect(Number.isFinite(candidate.headingDeg)).toBe(true);
        });
      }
    }
  });

  it("keeps the authored safe-gap path bounded in the logical material field", () => {
    for (const pattern of EXECUTABLE_PATTERNS) {
      for (let atMs = 0; atMs <= pattern.durationMs; atMs += 137) {
        const center = safeGapCenter(pattern, atMs);
        expect(center).toBeGreaterThanOrEqual(0);
        expect(center).toBeLessThanOrEqual(LOGICAL_VIEW_WIDTH);
      }
    }
    expect(LOGICAL_VIEW_HEIGHT).toBe(640);
  });

  it("serializes float provenance like Python canonical JSON", () => {
    expect(pythonCanonicalTrace({
      frames: [{atMs: 100, gapCenterX: -0, gapWidthPx: 34, bullets: [[1, 20, -0, 2, 1]]}],
      events: [{atMs: 0, count: 1}],
    })).toBe("{\"events\":[{\"atMs\":0.0,\"count\":1}],\"frames\":[{\"atMs\":100.0,\"bullets\":[[1,20.0,-0.0,2.0,1]],\"gapCenterX\":-0.0,\"gapWidthPx\":34.0}]}");
  });
});

describe("48-pattern Python oracle parity", () => {
  it("matches every exact trace hash and behavioral counter", () => {
    expect(determinismRows).toHaveLength(48);
    for (const row of determinismRows) {
      const trace = traces.get(row.patternId);
      expect(trace, row.patternId).toBeDefined();
      if (!trace) continue;
      expect(trace.traceSha256, row.patternId).toBe(row.traceSha256);
      expect(trace.traceSha256, `${row.patternId} repeat`).toBe(row.repeatSha256);
      expect(trace.events.length, `${row.patternId} emission events`).toBe(row.emissionEvents);
      expect(trace.omittedOrRedirected, `${row.patternId} safe-gap interventions`).toBe(
        row.gapInterventions,
      );
      expect(trace.splitChildren, `${row.patternId} split children`).toBe(row.splitChildren);
      expect(row.pass).toBe(true);
    }
  });

  it("is bit-stable across an independent second execution", () => {
    for (const row of determinismRows) {
      expect(simulatePattern(row.patternId, {seed: row.seed}).traceSha256, row.patternId).toBe(
        traces.get(row.patternId)?.traceSha256,
      );
    }
  });

  it("matches all 96 NORMAL/focus reachability paths exactly", () => {
    expect(safeGapRows).toHaveLength(48);
    for (const row of safeGapRows) {
      const pattern = executablePattern(row.patternId);
      const trace = traces.get(row.patternId);
      expect(trace, row.patternId).toBeDefined();
      if (!trace) continue;
      const normal = reachablePath(pattern, trace, false);
      const focus = reachablePath(pattern, trace, true);
      expect(normal, `${row.patternId} NORMAL path`).toEqual(row.normal);
      expect(focus, `${row.patternId} focus path`).toEqual(row.focus);
      expect(row.pass).toBe(true);
    }
  });
});

describe("declared production semantics and warning footprint", () => {
  it("makes lateral-wall opening and drift behavioral while retaining report compatibility explicitly", () => {
    const pattern = executablePattern("room.information.notification_overflow");
    const reference = simulatePattern(pattern);
    const declared = simulatePattern(pattern, {semantics: "declared-v4"});
    const visibleReference = reference.frames.reduce((total, frame) => total + frame.bullets.length, 0);
    const visibleDeclared = declared.frames.reduce((total, frame) => total + frame.bullets.length, 0);
    expect(visibleDeclared).toBeLessThan(visibleReference);
    expect(declared.traceSha256).not.toBe(reference.traceSha256);
  });

  it("keeps split descendants stable and source-owned", () => {
    const row = determinismRows.find((entry) => entry.patternId === "room.information.missing_ack");
    expect(row?.splitChildren).toBe(216);
    const trace = row ? traces.get(row.patternId) : undefined;
    const ids = trace?.frames.flatMap((frame) => frame.bullets.map((bullet) => bullet[0])) ?? [];
    expect(Math.max(...ids)).toBeGreaterThan(row?.splitChildren ?? 0);
  });

  it("collects deterministic swept circles that contain both integration endpoints", () => {
    const first = simulatePattern("common.graze_calibration", {collectWarningFootprint: true});
    const second = simulatePattern("common.graze_calibration", {collectWarningFootprint: true});
    const firstFootprint = first.warningFootprint ?? [];
    const secondFootprint = second.warningFootprint ?? [];
    expect(firstFootprint.length).toBeGreaterThan(100);
    expect(firstFootprint).toEqual(secondFootprint);
    for (const primitive of firstFootprint.slice(0, 100)) {
      expect(sweptCircleContainsPoint(primitive, primitive.from[0], primitive.from[1])).toBe(true);
      expect(sweptCircleContainsPoint(primitive, primitive.to[0], primitive.to[1])).toBe(true);
    }
  });

  it("uses a capsule distance test rather than endpoint-only warning coverage", () => {
    const primitive = sweptCirclePrimitive(
      100,
      {uid: 7, source: "fixture", generation: 0, radius: 2, collision: true},
      0,
      0,
      100,
      0,
    );
    expect(sweptCircleContainsPoint(primitive, 50, 1.9)).toBe(true);
    expect(sweptCircleContainsPoint(primitive, 50, 2.1)).toBe(false);
    expect(sweptCircleContainsPoint(primitive, 102, 0)).toBe(true);
  });
});
