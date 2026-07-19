import "./style.css";
import patternsManifest from "../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import frameIndex from "../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import {registerSW} from "virtual:pwa-register";
// Module-scope V4 asset bindings. Importing these runs their fail-fast content
// validation against the immutable V4 kit before anything else boots.
import {V4_SHARED_ASSETS} from "./assets/shared-v4";
import {AuthorityClock, elapsedWallDeltaMs, type Tick120Boundary} from "./authority/clock";
import {
  RunConductor,
  type ConductorRestorePhase,
  type ConductorSnapshot,
  type ConductorTickInput,
} from "./authority/conductor";
import {GAZE_AUTHORITY_CONTRACT} from "./authority/gaze";
import {CrossRunArchiveStore} from "./authority/persistence";
import type {FinalizedRunMemory} from "./authority/run-memory-model";
import {resolveRawRunSeed} from "./authority/run-seed";
import {AudioTrace} from "./game/audio";
import {
  FeedbackSubscriber,
  normalizeAccessibilityProfile,
  type FeedbackCueBatch,
  type NarrativeProjectionContext,
} from "./game/feedback";
import {
  HudView,
  UI_LAYOUT_COMMON,
  uiActionCopy,
  uiCopy,
  type HudDiscoveryFacts,
  type HudElementSource,
  type HudSource,
  type HudWritableElement,
} from "./game/hud";
import {InputManager, type InputFrame} from "./game/input";
import {canonicalPositionToView, projectPresentationSnapshot} from "./game/presentation";
import {
  GameView,
  MATERIAL_REMAINDER_REHYDRATE_ORDER,
  type GhostReplayPoint,
  type MaterialRemainderKind,
  type PresentationLayerFacts,
  type PresentedMaterialRemainder,
  type RoomReactionFacts,
} from "./game/renderer";
import type {FrameDefinition, PatternDefinition, SimulationSnapshot, Vec2} from "./game/types";

/*
 * ============================================================================
 * ENTRY POINT — the browser adapter for one authored run
 * ============================================================================
 * This file owns exactly three things: the wall-clock bridge, the device ->
 * gameplay-input adapter, and the fan-out of one frozen authority snapshot to
 * the presentation sinks. It holds no gameplay rule of its own. Every fact it
 * shows is read from `RunConductor`; nothing a sink produces is read back.
 *
 * RAF -> AuthorityClock BRIDGE SEMANTICS (proven in the previous entry point;
 * the authority clock itself lives in src/authority/clock.ts):
 *
 * 1. Wall-delta integrity. Every RAF computes `elapsedWallDeltaMs` and feeds
 *    the WHOLE delta to `authorityClock.advance`. AuthorityClock owns the
 *    1024-boundary cap and retains the remaining backlog, so truncating here
 *    would silently discard gameplay time after a long frame or a background
 *    suspension.
 * 2. Boot-interval discard. The interval ending at the first started RAF has
 *    no prior gameplay sample, so it is discarded once, and authority input is
 *    then seeded from the current aggregate held state — including a held
 *    Override whose pre-start edge was already polled away.
 * 3. Held-input reconciliation at wall-head. A newly polled sample may only
 *    target a FUTURE boundary; it never writes backward across the elapsed
 *    interval. Whenever the clock is not caught up to the wall head, held
 *    input is reconciled at the next caught-up frame: pending override edges
 *    are cleared and a synthetic press/release is emitted only when the device
 *    held state differs from what the authority last observed.
 * 4. Pause never leaks wall time. Pausing freezes gameplay time and DISCARDS
 *    the wall time observed while paused; resuming produces no catch-up burst.
 * 5. registerSW gated on !started. Promoting a waiting service worker reloads
 *    the page, so it is automatic only at the boot boundary, never mid-run.
 * ============================================================================
 */

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing required element #${id}`);
  return value as T;
}

const [LOGICAL_CANVAS_WIDTH, LOGICAL_CANVAS_HEIGHT] = UI_LAYOUT_COMMON.logicalCanvas;
const TICKS_PER_SECOND = 120;

// ---------------------------------------------------------------------------
// Device -> gameplay input adapter
// ---------------------------------------------------------------------------

/*
 * Two joins V4 deliberately leaves to the application: a held device action
 * carries one bit, while the authority consumes a continuous value. The
 * adapter therefore maps that bit onto the ENDS of the authored domain and
 * invents no intermediate magnitude — the shaping between the ends is already
 * authored (the flower priority override > gaze > focus > signal, the focus
 * cap, and the gaze FSM's own acquire/release timing).
 *
 * Signal: absence is 0, not a resting floor. "Not expressing" is an authored
 * absence, and a non-zero idle would make the world speak when the player has
 * said nothing — it would also make the authored 60-second signal discovery
 * prompt meaningless.
 */
const SIGNAL_INTENSITY_HELD = 1;
const SIGNAL_INTENSITY_ABSENT = 0;

/*
 * Gaze: a held intent carries no angle, so it resolves to the extremum of the
 * authored sample domain (pitch is validated within [-90, 90], alignment
 * within [0, 1]) rather than to a tuned number. Releasing it is the neutral
 * sample, not a "looking slightly away" value.
 */
const GAZE_PITCH_DEGREES_HELD = 90;
const GAZE_ALIGNMENT_HELD = 1;
const GAZE_PITCH_DEGREES_ABSENT = 0;
const GAZE_ALIGNMENT_ABSENT = 0;

// Fail closed if the authored thresholds ever move past what a held intent can
// express. The narrative First Eye guard reads `gaze.pitchDeg > threshold`, so
// the qualified sample must clear the gaze contract STRICTLY.
if (GAZE_PITCH_DEGREES_HELD <= GAZE_AUTHORITY_CONTRACT.pitchThresholdDegrees) {
  throw new Error("held gaze intent can no longer qualify the authored pitch threshold");
}
if (GAZE_ALIGNMENT_HELD < GAZE_AUTHORITY_CONTRACT.alignmentThreshold) {
  throw new Error("held gaze intent can no longer qualify the authored alignment threshold");
}

const HELD_CONTROLS: InputFrame = Object.freeze({
  move: Object.freeze({x: 0, y: 0}),
  shoot: false,
  focus: false,
  gazeIntent: false,
  overridePressed: false,
  overrideReleased: false,
  overrideHeld: false,
  overrideEdges: Object.freeze([]),
  pausePressed: false,
});

/** Device axes are y-up in view space; canonical gameplay space is y-down. */
function canonicalMovement(controls: InputFrame): Vec2 {
  return {x: controls.move.x, y: -controls.move.y};
}

// ---------------------------------------------------------------------------
// V4 content
// ---------------------------------------------------------------------------

const patterns = patternsManifest.patterns as PatternDefinition[];
const frames = frameIndex.frames as unknown as FrameDefinition[];
const patternById = new Map(patterns.map((pattern) => [pattern.id, pattern]));

function requirePattern(patternId: string): PatternDefinition {
  const pattern = patternById.get(patternId);
  if (pattern === undefined) throw new Error(`V4 pattern manifest does not author ${patternId}`);
  return pattern;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const canvas = element<HTMLCanvasElement>("game-canvas");
const stage = element<HTMLDivElement>("game-stage");
const bootOverlay = element<HTMLDivElement>("boot-overlay");
const bootButton = element<HTMLButtonElement>("boot-button");
const bootActionLabel = element<HTMLSpanElement>("boot-action-label");
const bootDescription = element<HTMLParagraphElement>("boot-description");
const runPhaseReadout = element<HTMLSpanElement>("run-phase-readout");
const headerClock = element<HTMLSpanElement>("header-clock");
const bossScreen = element<HTMLDivElement>("hud-boss");
const snapshotScreen = element<HTMLElement>("hud-snapshot");
const interruptionScreen = element<HTMLElement>("hud-interruption");
const crossRunScreen = element<HTMLElement>("hud-cross-run");
const crossRunNote = element<HTMLParagraphElement>("cross-run-note");
const crossRunTimeline = element<HTMLOListElement>("cross-run-timeline");
const observationsLayer = element<HTMLOListElement>("hud-state-snapshot-observations");
const reducedMotionInput = element<HTMLInputElement>("reduced-motion");
const flashOffInput = element<HTMLInputElement>("flash-off");
const audioInput = element<HTMLInputElement>("audio-enabled");

const snapshotContinue = element<HTMLButtonElement>("snapshot-action-continue");
const snapshotTitle = element<HTMLButtonElement>("snapshot-action-title");
const snapshotExport = element<HTMLButtonElement>("snapshot-action-export");
const interruptionSnapshot = element<HTMLButtonElement>("interruption-action-snapshot");
const interruptionContinue = element<HTMLButtonElement>("interruption-action-continue");
const interruptionTitle = element<HTMLButtonElement>("interruption-action-title");
const crossRunContinue = element<HTMLButtonElement>("cross-run-action-continue");
const crossRunFresh = element<HTMLButtonElement>("cross-run-action-fresh");

document.body.dataset.mode = "run";
document.title = "1bit / STG RUN 04";
element("surface-name").textContent = "STG RUN";
element("boot-atlases").textContent = `${Object.keys(V4_SHARED_ASSETS.atlases).length} ATLASES`;

const CONTINUE_WITH_MEMORY = uiCopy("continue.withMemory");
const CONTINUE_WITHOUT_MEMORY = uiCopy("continue.withoutMemory");
const CONTINUE_NOTE = uiCopy("continue.note");
const RUN_INTERRUPTED = uiCopy("run.interrupted");

// ---------------------------------------------------------------------------
// Raw run seed (fail closed) and the durable archive
// ---------------------------------------------------------------------------

function resolveSeedOrFailClosed(): number {
  const requested = new URLSearchParams(window.location.search).get("seed");
  try {
    return resolveRawRunSeed(requested, () => {
      const generated = new Uint32Array(1);
      crypto.getRandomValues(generated);
      return generated[0] ?? 0;
    });
  } catch (error) {
    // An explicit reproducibility request that cannot be honoured must never be
    // silently replaced by a fresh seed.
    document.body.dataset.startupFailure = "invalid-seed";
    bootButton.disabled = true;
    bootActionLabel.textContent = RUN_INTERRUPTED.zhCN;
    bootButton.title = RUN_INTERRUPTED.en;
    bootDescription.textContent = String(error);
    throw error;
  }
}

const rawRunSeed = resolveSeedOrFailClosed();
document.body.dataset.rawRunSeed = String(rawRunSeed);
element("boot-seed").textContent = String(rawRunSeed);

/** A missing or corrupt archive null-routes: boot proceeds with no memory. */
function openArchive(): CrossRunArchiveStore | null {
  try {
    return new CrossRunArchiveStore();
  } catch {
    return null;
  }
}

const archive = openArchive();

/** The archive is the only source of a previous run; absence is not an error. */
function restoredPreviousRun(): FinalizedRunMemory | null {
  return archive?.loadLatest() ?? null;
}

// ---------------------------------------------------------------------------
// Presentation sinks
// ---------------------------------------------------------------------------

const input = new InputManager(canvas, (label, connected) => {
  const status = element<HTMLSpanElement>("gamepad-status");
  status.classList.toggle("connected", connected);
  status.textContent = connected ? `● ${label.slice(0, 24)}` : "○ GAMEPAD";
  status.title = connected ? label : "等待标准映射游戏手柄";
});

/*
 * The DOM types `hidden` as `string | boolean` (it accepts the `until-found`
 * value), while the HUD sink declares the narrower boolean it actually writes.
 * Every other member matches exactly, so the variance is asserted once here
 * instead of widening the sink's contract to something it never assigns.
 */
function asHudElement(node: HTMLElement): HudWritableElement {
  return node as unknown as HudWritableElement;
}

const hudDocument: HudElementSource = {
  getElementById: (id) => {
    const node = document.getElementById(id);
    return node === null ? null : asHudElement(node);
  },
};

const view = new GameView(canvas, frames);
const hudView = new HudView(hudDocument);
const audio = new AudioTrace({
  createContext: () => new AudioContext(),
  fetchAudio: async (url) => (await fetch(url)).arrayBuffer(),
});

function applyStageScale(): void {
  const frameElement = stage.parentElement;
  hudView.applyStageScale(
    asHudElement(stage),
    frameElement?.clientWidth ?? window.innerWidth,
    window.innerHeight,
  );
  view.resize();
}

window.addEventListener("resize", applyStageScale);

// Atlases, composites and reaction overlays load before the first render.
await view.initialize();
applyStageScale();

// ---------------------------------------------------------------------------
// Accessibility — presentation only. None of this reaches the conductor.
// ---------------------------------------------------------------------------

let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let flashOff = false;
reducedMotionInput.checked = reducedMotion;

function applyAccessibilityProfile(): void {
  document.body.dataset.reducedMotion = String(reducedMotion);
  document.body.dataset.flashOff = String(flashOff);
  feedback.setAccessibilityProfile(
    normalizeAccessibilityProfile({
      ...(reducedMotion ? {motion: "reduced"} : {}),
      ...(flashOff ? {flashing: "off"} : {}),
    }),
  );
}

reducedMotionInput.addEventListener("change", () => {
  reducedMotion = reducedMotionInput.checked;
  applyAccessibilityProfile();
});
flashOffInput.addEventListener("change", () => {
  flashOff = flashOffInput.checked;
  applyAccessibilityProfile();
});
audioInput.addEventListener("change", () => audio.setEnabled(audioInput.checked));

// ---------------------------------------------------------------------------
// Wall-clock bridge state
// ---------------------------------------------------------------------------

interface AuthorityInputSample {
  readonly controls: InputFrame;
}

let authorityClock = new AuthorityClock<AuthorityInputSample>({onTick120: advanceAuthorityBoundary});
let authorityControls: InputFrame = HELD_CONTROLS;
const pendingOverrideEdges: Array<"press" | "release"> = [];
let lastCanonicalDirection: Vec2 = {x: 0, y: -1};
let authorityOverrideHeld = false;
let reconcileHeldInputAtWallHead = false;
let discardNextStartedWallInterval = true;
let pendingSnapshotContinue = false;
let pendingSnapshotTitle = false;
let signalHeld = false;
let previousTime = performance.now();
let started = false;
let paused = false;
/** Set once an authority refused a tick. Gameplay time never resumes after it. */
let runFailure: string | null = null;

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

interface RunPresentationState {
  readonly conductor: RunConductor;
  readonly previousRun: FinalizedRunMemory | null;
  snapshot: ConductorSnapshot;
  simulation: SimulationSnapshot;
  horizonSeen: boolean;
  gazeThresholdCrossed: boolean;
  signalInputCount: number;
  thresholdFactCount: number;
  snapshotScreenOpened: boolean;
  presentedRoom: string;
  presentedGazeClamped: boolean;
  presentedRestoreSteps: number;
  /** The recorded route is immutable, so its per-room projection is cached. */
  readonly ghostPointsByRoom: Map<string, readonly GhostReplayPoint[]>;
}

let feedback = new FeedbackSubscriber();
let run: RunPresentationState | null = null;
let runOrdinal = 0;

function currentRun(): RunPresentationState {
  if (run === null) throw new Error("no run is configured");
  return run;
}

function projectRun(state: RunPresentationState): void {
  state.snapshot = state.conductor.snapshot();
  state.simulation = projectPresentationSnapshot(
    state.snapshot,
    requirePattern(state.snapshot.patternId),
  );
}

function startRun(previousRun: FinalizedRunMemory | null): void {
  runOrdinal += 1;
  const conductor = new RunConductor({
    runId: `run:${rawRunSeed}:${runOrdinal}`,
    rawRunSeed,
    previousRun,
    archive,
  });
  const snapshot = conductor.snapshot();
  run = {
    conductor,
    previousRun,
    snapshot,
    simulation: projectPresentationSnapshot(snapshot, requirePattern(snapshot.patternId)),
    horizonSeen: false,
    gazeThresholdCrossed: false,
    signalInputCount: 0,
    thresholdFactCount: 0,
    snapshotScreenOpened: false,
    presentedRoom: "",
    presentedGazeClamped: false,
    presentedRestoreSteps: -1,
    ghostPointsByRoom: new Map(),
  };
  feedback = new FeedbackSubscriber();
  applyAccessibilityProfile();
  document.body.dataset.authority = snapshot.authority;

  // Every run starts its own wall bridge: the interval that ends at the first
  // started frame has no prior gameplay sample and is discarded (semantic 2).
  authorityClock = new AuthorityClock<AuthorityInputSample>({onTick120: advanceAuthorityBoundary});
  discardNextStartedWallInterval = true;
  reconcileHeldInputAtWallHead = true;
  authorityControls = HELD_CONTROLS;
  authorityOverrideHeld = false;
  pendingOverrideEdges.length = 0;
  pendingSnapshotContinue = false;
  pendingSnapshotTitle = false;
  lastCanonicalDirection = {x: 0, y: -1};
  paused = false;
  runFailure = null;
  delete document.body.dataset.runFailure;
  document.body.classList.remove("paused");
}

/**
 * An authority that refuses a tick is a fail-closed stop, never something
 * presentation may retry, swallow or paper over: gameplay time ends here for
 * good. It is caught only so the reason stays observable and the last frame
 * stays on screen, instead of the frame loop dying silently mid-run.
 */
function advanceGameplayTime(elapsedMs: number): boolean {
  try {
    return authorityClock.advance(elapsedMs).backlogTicks === 0;
  } catch (error) {
    runFailure = String(error);
    document.body.dataset.runFailure = runFailure;
    return false;
  }
}

// ---------------------------------------------------------------------------
// One authoritative tick
// ---------------------------------------------------------------------------

function inputPolicyOf(conductor: RunConductor): string {
  const state = conductor.machine.states.get(conductor.runPhase);
  if (state === undefined) throw new Error(`narrative state is not authored: ${conductor.runPhase}`);
  return state.inputPolicy;
}

function advanceAuthorityBoundary(boundary: Tick120Boundary<AuthorityInputSample>): void {
  for (const stamped of boundary.inputs) {
    authorityControls = stamped.value.controls;
    pendingOverrideEdges.push(...stamped.value.controls.overrideEdges);
    const movement = canonicalMovement(stamped.value.controls);
    if (Math.hypot(movement.x, movement.y) > Number.EPSILON) lastCanonicalDirection = movement;
  }

  const state = run;
  if (state === null || state.conductor.complete) {
    authorityControls = {...authorityControls, overrideEdges: [], pausePressed: false};
    return;
  }

  const policy = inputPolicyOf(state.conductor);
  // Override is an authored phase capability. While that input surface is
  // absent, a queued edge belongs to no authority: it is dropped rather than
  // replayed later, and the held difference is reconciled when input returns
  // (semantic 3), so a still-held button produces a fresh press at that point.
  let overrideEdge: "press" | "release" | undefined;
  if (policy === "full") {
    overrideEdge = pendingOverrideEdges.shift();
    if (overrideEdge !== undefined) authorityOverrideHeld = overrideEdge === "press";
  } else if (pendingOverrideEdges.length > 0 || authorityOverrideHeld) {
    pendingOverrideEdges.length = 0;
    authorityOverrideHeld = false;
    reconcileHeldInputAtWallHead = true;
  }

  // Snapshot navigation edges are consumed by exactly one boundary, and only by
  // a state that actually admits them.
  const snapshotNavigable = policy === "snapshot-navigation";
  const continueRequested = snapshotNavigable && pendingSnapshotContinue;
  const titleRequested = snapshotNavigable && pendingSnapshotTitle;
  if (snapshotNavigable) {
    pendingSnapshotContinue = false;
    pendingSnapshotTitle = false;
  }

  const tickInput: ConductorTickInput = {
    movement: canonicalMovement(authorityControls),
    focused: authorityControls.focus,
    signalIntensity: authorityControls.shoot ? SIGNAL_INTENSITY_HELD : SIGNAL_INTENSITY_ABSENT,
    gazeIntent: authorityControls.gazeIntent,
    gazePitchDegrees: authorityControls.gazeIntent
      ? GAZE_PITCH_DEGREES_HELD
      : GAZE_PITCH_DEGREES_ABSENT,
    gazeAlignment: authorityControls.gazeIntent ? GAZE_ALIGNMENT_HELD : GAZE_ALIGNMENT_ABSENT,
    overridePressed: overrideEdge === "press",
    overrideReleased: overrideEdge === "release",
    ...(overrideEdge === "press" ? {overrideDirection: lastCanonicalDirection} : {}),
    snapshotContinueRequested: continueRequested,
    snapshotTitleRequested: titleRequested,
  };

  state.conductor.step(tickInput);
  projectRun(state);
  observeDiscovery(state, tickInput, policy);
  drainFeedback(state);

  // Edge facts are consumed by exactly one master boundary. Held axes and
  // buttons remain authoritative until a later sample replaces them.
  authorityControls = {
    ...authorityControls,
    overridePressed: false,
    overrideReleased: false,
    overrideEdges: [],
    pausePressed: false,
  };
}

// ---------------------------------------------------------------------------
// Discovery facts — authority-observed, latched, never inferred from the DOM
// ---------------------------------------------------------------------------

function observeDiscovery(
  state: RunPresentationState,
  tickInput: ConductorTickInput,
  policy: string,
): void {
  // Only an edge the authority actually admitted counts as a signal input; an
  // action pressed while that surface is absent never reached the world.
  const signalAdmitted = policy === "full" || policy === "movement-and-signal";
  const signalActive = signalAdmitted && tickInput.signalIntensity > 0;
  if (signalActive && !signalHeld) state.signalInputCount += 1;
  signalHeld = signalActive;
  // The horizon is what the First Eye puts in the sky; it stays discovered.
  if (state.snapshot.runPhase === "FIRST_EYE") state.horizonSeen = true;
  if (state.snapshot.gazeState !== "idle") state.gazeThresholdCrossed = true;
}

function discoveryFacts(state: RunPresentationState): HudDiscoveryFacts {
  return {
    signalInputCount: state.signalInputCount,
    horizonVisible: state.horizonSeen,
    gazeThresholdCrossed: state.gazeThresholdCrossed,
    tracePanelOpened: hudView.expandedObservationIds.length > 0,
    // The boss loop is a later slice. Until it exists this is authored absence,
    // not a false claim that a condition component was already met.
    hasEncounteredConditionComponent: false,
    snapshotOpen: state.snapshot.runPhase === "STATE_SNAPSHOT",
  };
}

// ---------------------------------------------------------------------------
// Feedback fan-out — read-only sinks
// ---------------------------------------------------------------------------

function drainFeedback(state: RunPresentationState): void {
  // Only predicates the conductor already owns and publishes are supplied.
  // Every other projection stays absent rather than being re-derived here,
  // which would create a second narrative authority.
  const context: NarrativeProjectionContext = {
    roomThresholdCommitted: state.snapshot.thresholdFacts.length > state.thresholdFactCount,
  };
  state.thresholdFactCount = state.snapshot.thresholdFacts.length;
  applyFeedback(feedback.consumeTick(state.conductor.tick120, state.conductor.bus, context));
}

function applyFeedback(batch: FeedbackCueBatch): void {
  for (const cue of batch.audio) {
    // The room bed is owned by the authoritative room change and crossfaded by
    // AudioTrace. The transition cue resolves a bed id through a selector that
    // misses for one room, so a bed is never started from a cue.
    if (cue.asset.category === "room-bed") continue;
    audio.playAsset(cue.asset);
  }
  for (const cue of batch.haptic) {
    for (const pulse of cue.pulses) {
      if (pulse.atMs <= 0) {
        void input.pulse(pulse.durationMs, pulse.strength, pulse.strength);
        continue;
      }
      window.setTimeout(
        () => void input.pulse(pulse.durationMs, pulse.strength, pulse.strength),
        pulse.atMs,
      );
    }
  }
  // batch.ui and batch.visual are consumed and deliberately not displayed.
  // A UI cue's `note` is the authored TREATMENT ("flower bar notch 1",
  // "run interruption strip"), not a sentence written for the player, and the
  // visual cues are frame swaps the renderer has no cue-application port for.
  // Showing either verbatim would put authoring instructions on screen, so
  // both stay silent until their real surfaces exist.
}

// ---------------------------------------------------------------------------
// Cross-run material projection
// ---------------------------------------------------------------------------

function restoreReached(state: RunPresentationState, phase: ConductorRestorePhase): number | null {
  const step = state.snapshot.restoreProgress.find((entry) => entry.phase === phase);
  return step === undefined ? null : step.tick120;
}

function materialPosition(xNorm: number, yNorm: number): Vec2 {
  return canonicalPositionToView({
    x: xNorm * LOGICAL_CANVAS_WIDTH,
    y: yNorm * LOGICAL_CANVAS_HEIGHT,
  });
}

/**
 * The previous run's matter, placed only in the room it was left in and only
 * after the restore step that owns it has actually been reached. Burn-in is
 * authored with a room but no coordinate, so it is deliberately not placed:
 * inventing a position for it would invent a material fact.
 */
function materialRemainders(state: RunPresentationState): readonly PresentedMaterialRemainder[] {
  const memory = state.previousRun?.materialMemory;
  if (memory === undefined) return [];
  const room = state.snapshot.roomId;
  const byKind: Record<MaterialRemainderKind, PresentedMaterialRemainder[]> = {
    overrideScar: [],
    deathTrace: [],
    burnIn: [],
    ghostResidue: [],
  };
  if (restoreReached(state, "material") !== null) {
    for (const scar of memory.overrideScars) {
      if (scar.position.room !== room) continue;
      byKind.overrideScar.push({
        id: scar.id,
        kind: "overrideScar",
        position: materialPosition(scar.position.xNorm, scar.position.yNorm),
      });
    }
    for (const trace of memory.deathTraces) {
      if (trace.position.room !== room) continue;
      byKind.deathTrace.push({
        id: trace.id,
        kind: "deathTrace",
        position: materialPosition(trace.position.xNorm, trace.position.yNorm),
      });
    }
  }
  if (restoreReached(state, "ghost-residue") !== null) {
    for (const residue of memory.ghostResidues) {
      if (residue.position.room !== room) continue;
      byKind.ghostResidue.push({
        id: residue.id,
        kind: "ghostResidue",
        position: materialPosition(residue.position.xNorm, residue.position.yNorm),
      });
    }
  }
  // The authored rehydrate order, read from the ghost replay contract.
  return MATERIAL_REMAINDER_REHYDRATE_ORDER.flatMap((kind) => byKind[kind]);
}

interface GhostReplayFacts {
  readonly points: readonly GhostReplayPoint[];
  readonly headIndex: number;
}

const EMPTY_GHOST: GhostReplayFacts = Object.freeze({points: Object.freeze([]), headIndex: 0});

/**
 * The previous run's actual route, replayed between the two authored restore
 * steps that bracket it. The head is a pure function of authority ticks and the
 * recorded timestamps; presentation never advances it on a clock of its own.
 */
function ghostReplay(state: RunPresentationState): GhostReplayFacts {
  const route = state.previousRun?.ghostRoute;
  if (route === undefined || route === null) return EMPTY_GHOST;
  const beganAtTick = restoreReached(state, "ghost-replay-begin");
  if (beganAtTick === null || restoreReached(state, "ghost-replay-complete") !== null) {
    return EMPTY_GHOST;
  }
  const room = state.snapshot.roomId;
  let points = state.ghostPointsByRoom.get(room);
  if (points === undefined) {
    points = Object.freeze(
      route.points
        .filter((point) => point.room === room)
        .map((point): GhostReplayPoint => ({
          tMs: point.tMs,
          position: materialPosition(point.xNorm, point.yNorm),
          eventPin: point.flags.length > 0,
        })),
    );
    state.ghostPointsByRoom.set(room, points);
  }
  if (points.length === 0) return EMPTY_GHOST;
  const elapsedMs = (state.snapshot.tick120 - beganAtTick) * 1000 / TICKS_PER_SECOND;
  let headIndex = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point !== undefined && point.tMs <= elapsedMs) headIndex = index;
  }
  return {points, headIndex};
}

/**
 * The four world-reaction facts the conductor already owns. The renderer owns
 * which one wins when several hold at once; this only reports them.
 */
function reactionFacts(state: RunPresentationState): RoomReactionFacts {
  return {
    roomThresholdActive: state.snapshot.roomThresholdTargetRoom !== undefined,
    materialMemoryActive: restoreInProgress(state),
    weatherAftermathActive: state.snapshot.weather.phase === "aftermath",
    // NO_DUSK is the authored refusal of dusk, so it is deliberately not here.
    duskActive: state.snapshot.runPhase === "DUSK_APPROACH",
  };
}

function restoreInProgress(state: RunPresentationState): boolean {
  return state.snapshot.restoreTimeline.length > 0
    && state.snapshot.restoreProgress.length < state.snapshot.restoreTimeline.length;
}

function presentationLayers(state: RunPresentationState): PresentationLayerFacts {
  const ghost = ghostReplay(state);
  return {
    reaction: reactionFacts(state),
    weather: {classId: state.snapshot.weather.classId, phase: state.snapshot.weather.phase},
    materialRemainders: materialRemainders(state),
    ghostReplay: ghost.points,
    ghostHeadIndex: ghost.headIndex,
  };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function hudSourceOf(state: RunPresentationState): HudSource {
  return {
    snapshot: state.snapshot,
    discovery: discoveryFacts(state),
    accessibility: {reducedMotion, flashingOff: flashOff, audioDescriptions: false},
    finalized: state.conductor.finalizedRecord(),
    previousRun: state.previousRun,
    // No boss protocol is present in this slice; those layers resolve to
    // authored absence rather than to placeholder values.
    boss: null,
    expandedObservationIds: hudView.expandedObservationIds,
  };
}

function renderRunScreens(state: RunPresentationState, source: HudSource): void {
  const phase = state.snapshot.runPhase;
  const observing = phase === "STATE_SNAPSHOT";
  // The interruption screen is the authored surface for a route that stopped
  // with the body. Its own actions are all admissible while the snapshot is
  // navigable, so it holds the observation until the player asks for the full
  // snapshot.
  const interrupted = observing
    && state.snapshot.runEndReason === "BODY_COLLAPSE"
    && !state.snapshotScreenOpened;
  snapshotScreen.hidden = !observing || interrupted;
  interruptionScreen.hidden = !interrupted;
  if (observing) hudView.renderScreen(interrupted ? "failure" : "state_snapshot", source);

  // The handoff panel is shown only at the handoff. While the restore is still
  // playing, the world itself is the restore — the ghost route, the scars and
  // the residue are what the player is meant to watch, so presentation does not
  // cover them with a description of what they are already seeing.
  const handingOff = state.conductor.complete || phase === "CROSS_RUN_MATERIALIZATION";
  crossRunScreen.hidden = !handingOff;
  if (handingOff) renderCrossRun(state);
}

function renderCrossRun(state: RunPresentationState): void {
  const reachedCount = state.snapshot.restoreProgress.length;
  if (state.presentedRestoreSteps === reachedCount) return;
  state.presentedRestoreSteps = reachedCount;
  crossRunNote.textContent = CONTINUE_NOTE.zhCN;
  const reached = new Set(state.snapshot.restoreProgress.map((step) => step.phase));
  crossRunTimeline.replaceChildren(
    ...state.snapshot.restoreTimeline.map((step) => {
      const item = document.createElement("li");
      item.textContent = step.phase;
      item.dataset.reached = String(reached.has(step.phase));
      return item;
    }),
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function labelAction(button: HTMLButtonElement, action: string): void {
  const copy = uiActionCopy(action);
  if (copy === null) return;
  button.textContent = copy.zhCN;
  button.title = copy.en;
}

labelAction(snapshotContinue, "continueWithMemory");
labelAction(snapshotTitle, "title");
labelAction(interruptionSnapshot, "openSnapshot");
labelAction(interruptionContinue, "continueWithMemory");
labelAction(interruptionTitle, "title");
labelAction(crossRunContinue, "continueWithMemory");
labelAction(crossRunFresh, "newRunWithoutMemory");
// The PNG export has no authored sentence and no implementation in this slice.
// An action the player cannot use is not shown.
snapshotExport.hidden = true;

snapshotContinue.addEventListener("click", () => {
  pendingSnapshotContinue = true;
});
interruptionContinue.addEventListener("click", () => {
  pendingSnapshotContinue = true;
});
snapshotTitle.addEventListener("click", () => {
  pendingSnapshotTitle = true;
});
interruptionTitle.addEventListener("click", () => {
  pendingSnapshotTitle = true;
});
interruptionSnapshot.addEventListener("click", () => {
  // A presentation-only swap between two authored screens.
  currentRun().snapshotScreenOpened = true;
});
crossRunContinue.addEventListener("click", () => startRun(restoredPreviousRun()));
crossRunFresh.addEventListener("click", () => startRun(null));

// Expand-only, exactly as the fact_traces layer is authored: each request
// reveals the traces behind the next observation that is still folded.
observationsLayer.addEventListener("click", () => {
  const expanded = new Set(hudView.expandedObservationIds);
  const next = currentRun().snapshot.observations.find((entry) => !expanded.has(entry.id));
  if (next !== undefined) hudView.expandObservation(next.id);
});

function begin(): void {
  if (started) return;
  started = true;
  bootOverlay.classList.add("leaving");
  // A real user gesture is the only place an AudioContext may be created.
  audio.unlock();
  audio.setEnabled(audioInput.checked);
}

bootButton.addEventListener("click", begin);
window.addEventListener("keydown", (event) => {
  if (event.code === "Enter" && !started) begin();
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

function frame(time: number): void {
  const elapsed = elapsedWallDeltaMs(previousTime, time);
  previousTime = time;
  const state = currentRun();

  // Exactly one poll per frame: edges are consumed by polling.
  input.setPlayerPosition(state.simulation.player.position);
  const controls = input.poll();
  let controlsForAuthority = controls;

  if (started && runFailure === null) {
    // AuthorityClock owns the boundary cap and retains backlog, so the whole
    // wall delta is offered to it (semantic 1).
    const wallHeadCaughtUp = discardNextStartedWallInterval
      ? true
      : advanceGameplayTime(elapsed);
    if (discardNextStartedWallInterval) {
      discardNextStartedWallInterval = false;
      reconcileHeldInputAtWallHead = true;
    }
    if (!wallHeadCaughtUp) reconcileHeldInputAtWallHead = true;

    if (controls.pausePressed) {
      const wasPaused = paused;
      paused = !paused;
      authorityClock.setPaused(paused);
      document.body.classList.toggle("paused", paused);
      if (paused) {
        authorityClock.clearQueuedInputs();
        reconcileHeldInputAtWallHead = true;
        if (wallHeadCaughtUp) {
          pendingOverrideEdges.length = 0;
          authorityControls = HELD_CONTROLS;
        }
      } else if (wasPaused) {
        // The resume-frame interval was offered while the clock was still
        // paused, so AuthorityClock discarded it. Held input is reconciled only
        // after any older retained backlog has drained.
        reconcileHeldInputAtWallHead = true;
      }
    }

    if (!paused && wallHeadCaughtUp && !state.conductor.complete) {
      if (reconcileHeldInputAtWallHead) {
        pendingOverrideEdges.length = 0;
        if (controls.overrideHeld !== authorityOverrideHeld) {
          pendingOverrideEdges.push(controls.overrideHeld ? "press" : "release");
        }
        controlsForAuthority = {
          ...controls,
          overridePressed: false,
          overrideReleased: false,
          overrideEdges: [],
          pausePressed: false,
        };
        reconcileHeldInputAtWallHead = false;
      }
      authorityClock.enqueueInput({controls: {...controlsForAuthority, pausePressed: false}});
    }
  }

  present(state);
  requestAnimationFrame(frame);
}

function present(state: RunPresentationState): void {
  const snapshot = state.snapshot;
  view.render(state.simulation, reducedMotion, flashOff, presentationLayers(state));

  const source = hudSourceOf(state);
  hudView.renderScreen("gameplay_hud", source);
  const boss = hudView.renderScreen("boss_hud", source);
  bossScreen.hidden = !boss.layers.some((layer) => layer.visible);
  hudView.renderDiscoveryPrompts(source);
  renderRunScreens(state, source);

  if (state.presentedRoom !== snapshot.roomId) {
    state.presentedRoom = snapshot.roomId;
    // Canonical room id: AudioTrace resolves the authored slug itself.
    audio.setRoom(snapshot.roomId);
  }
  const gazeClamped = snapshot.gazeState === "clamped" || snapshot.gazeState === "release-delay";
  if (state.presentedGazeClamped !== gazeClamped) {
    state.presentedGazeClamped = gazeClamped;
    audio.setGazeClamped(gazeClamped);
  }

  canvas.dataset.presentedRoom = state.simulation.room;
  canvas.dataset.presentedPatternId = state.simulation.pattern.id;
  runPhaseReadout.textContent = snapshot.runPhase;
  headerClock.textContent = (snapshot.hud.runElapsedMs / 1000).toFixed(3).padStart(7, "0");

  // Deliberately small and stable: which authority is live, where it is in
  // gameplay time, which seed produced it, and which phase it is in.
  document.body.dataset.authority = snapshot.authority;
  document.body.dataset.authorityTick = String(snapshot.tick120);
  document.body.dataset.runPhase = snapshot.runPhase;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

startRun(restoredPreviousRun());

// The boot action states what continuing actually brings back; with no retained
// matter it states that instead. No new sentence is written here.
const bootPreviousRun = currentRun().previousRun;
bootActionLabel.textContent = bootPreviousRun === null
  ? CONTINUE_WITHOUT_MEMORY.zhCN
  : CONTINUE_WITH_MEMORY.zhCN;
bootButton.title = bootPreviousRun === null ? CONTINUE_WITHOUT_MEMORY.en : CONTINUE_WITH_MEMORY.en;
if (bootPreviousRun !== null) bootDescription.textContent = CONTINUE_NOTE.zhCN;

requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Service worker — never promoted mid-run
// ---------------------------------------------------------------------------

let applyWaitingServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
applyWaitingServiceWorkerUpdate = registerSW({
  immediate: true,
  onOfflineReady: () => {
    document.body.dataset.offlineReady = "true";
  },
  onNeedRefresh: () => {
    document.body.dataset.updateReady = "true";
    // Promoting a waiting worker reloads the page, so it is only automatic
    // while the boot boundary has produced no gameplay ticks (semantic 5).
    if (!started && applyWaitingServiceWorkerUpdate) void applyWaitingServiceWorkerUpdate(true);
  },
});
