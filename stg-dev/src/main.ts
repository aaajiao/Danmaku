import "./style.css";
import patternsManifest from "../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import frameIndex from "../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import uiCopyManifest from "../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ui-copy-v4.json";
import {registerSW} from "virtual:pwa-register";
import {
  AuthorityClock,
  MASTER_TICK_HZ,
  elapsedWallDeltaMs,
  type Tick120Boundary,
} from "./authority/clock";
import {resolveRawRunSeed} from "./authority/run-seed";
import {AudioTrace} from "./game/audio";
import {InputManager, type InputFrame} from "./game/input";
import {projectCanonicalRunSession} from "./game/presentation";
import {GameView} from "./game/renderer";
import {GameSimulation} from "./game/simulation";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
} from "./authority/run-session";
import type {
  Difficulty,
  FrameDefinition,
  PatternDefinition,
  SimulationEvent,
  SimulationSnapshot,
} from "./game/types";

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing required element #${id}`);
  return value as T;
}

function resolveCanonicalRawRunSeed(params: URLSearchParams): number {
  try {
    return resolveRawRunSeed(params.get("seed"), () => {
      const generated = new Uint32Array(1);
      crypto.getRandomValues(generated);
      return generated[0] ?? 0;
    });
  } catch (error) {
    document.body.dataset.startupFailure = "invalid-seed";
    bootButton.disabled = true;
    element("boot-action-label").textContent = RUN_INTERRUPTED_COPY.zhCN;
    bootButton.title = RUN_INTERRUPTED_COPY.en;
    throw error;
  }
}

function canonicalUiCopy(id: string): Readonly<{zhCN: string; en: string}> {
  if (uiCopyManifest.schemaVersion !== "4.0.0-ui-copy") {
    throw new Error("V4 UI copy schema identity drifted");
  }
  const entry = (uiCopyManifest.copy as Readonly<Record<string, Readonly<Record<string, unknown>>>>)[id];
  const zhCN = entry?.["zh-CN"];
  const en = entry?.en;
  if (typeof zhCN !== "string" || zhCN.length === 0 || typeof en !== "string" || en.length === 0) {
    throw new Error(`V4 UI copy is missing ${id}`);
  }
  return Object.freeze({zhCN, en});
}

const SIGNAL_FALLBACK_COPY = canonicalUiCopy("prompt.signal");
const RUN_INTERRUPTED_COPY = canonicalUiCopy("run.interrupted");
const CONTINUE_WITHOUT_MEMORY_COPY = canonicalUiCopy("continue.withoutMemory");

const params = new URLSearchParams(window.location.search);
const patternLabMode = params.get("mode") === "pattern-lab";
const requestedPresentationProfile = params.get("profile") ?? "full";
if (!["full", "reduced-motion", "flash-off"].includes(requestedPresentationProfile)) {
  throw new Error("presentation profile must be full, reduced-motion, or flash-off");
}
const presentationProfile = requestedPresentationProfile as "full" | "reduced-motion" | "flash-off";
const patterns = patternsManifest.patterns as PatternDefinition[];
const patternById = new Map(patterns.map((pattern) => [pattern.id, pattern]));
const frames = frameIndex.frames as unknown as FrameDefinition[];
const canvas = element<HTMLCanvasElement>("game-canvas");
const bootOverlay = element<HTMLDivElement>("boot-overlay");
const bootButton = element<HTMLButtonElement>("boot-button");
const patternSelect = element<HTMLSelectElement>("pattern-select");
const eventLog = element<HTMLOListElement>("event-log");
const warning = element<HTMLDivElement>("warning");
const toast = element<HTMLDivElement>("toast");
const signalFallback = element<HTMLDivElement>("signal-fallback");
signalFallback.textContent = SIGNAL_FALLBACK_COPY.zhCN;
signalFallback.title = SIGNAL_FALLBACK_COPY.en;
const difficultyInput = element<HTMLInputElement>("difficulty");
const audio = new AudioTrace();
let started = false;
let toastTimer = 0;

const input = new InputManager(canvas, (label, connected) => {
  const status = element<HTMLSpanElement>("gamepad-status");
  status.classList.toggle("connected", connected);
  status.textContent = connected ? `● ${label.slice(0, 24)}` : "○ GAMEPAD";
  status.title = connected ? label : "等待标准映射游戏手柄";
});

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1300);
}

function logEvent(event: SimulationEvent): void {
  const item = document.createElement("li");
  const timestamp = (event.atMs / 1000).toFixed(3).padStart(7, "0");
  item.innerHTML = `<time>${timestamp}</time><span>${event.detail}</span>`;
  item.dataset.type = event.type;
  eventLog.prepend(item);
  while (eventLog.children.length > 7) eventLog.lastElementChild?.remove();
  audio.play(event.type);

  if (event.type === "graze") {
    void input.pulse(8, 0.08, 0.18);
  } else if (event.type === "damage") {
    void input.pulse(55, 0.65, 0.35);
    if (patternLabMode) showToast("BODY INTERRUPTED");
  } else if (event.type === "override") {
    void input.pulse(45, 0.8, 0.25);
    if (patternLabMode) showToast("LOCAL VOID / 局部缺席");
  } else if (event.type === "override-denied") {
    if (patternLabMode) showToast("EVIDENCE 需要 03");
  } else if (event.type === "protocol") {
    void input.pulse(30, 0.18, 0.3);
    if (patternLabMode) showToast("PROTOCOL OBSERVED");
  }
}

const simulation = patternLabMode ? new GameSimulation(patterns, logEvent) : null;
const canonicalRun = patternLabMode
  ? null
  : new CanonicalRunSession({
      // URL seed is the raw Run identity. Occurrence seeds are resolved inside
      // the authority boundary with the explicit EXT-005 salt policy.
      rawRunSeed: Object.freeze({
        domain: "raw-run-seed" as const,
        value: resolveCanonicalRawRunSeed(params),
      }),
      grazeRadiusPx: 18,
      projectileDamage: 1,
      projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
    });
const view = new GameView(canvas, frames);
let canonicalEventCursor = 0;
let canonicalPhase: CanonicalRunSessionSnapshot["phase"] | null = null;
let paused = false;

function populatePatternSelect(): void {
  const groups = new Map<string, HTMLOptGroupElement>();
  const labels: Record<string, string> = {
    ROOM: "房间 / ROOM",
    COMMON: "通用 / COMMON",
    TRANSITION: "过渡 / TRANSITION",
    WEATHER_ECHO: "天气回声 / WEATHER ECHO",
    BOSS: "Boss / 8 × 3 PHASES",
  };
  patterns.forEach((pattern, index) => {
    let group = groups.get(pattern.category);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = labels[pattern.category] ?? pattern.category;
      groups.set(pattern.category, group);
      patternSelect.append(group);
    }
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${String(index + 1).padStart(2, "0")} · ${pattern.name.zh}`;
    group.append(option);
  });
}

function updatePatternPanel(snapshot: SimulationSnapshot): void {
  const pattern = snapshot.pattern;
  const index = patterns.indexOf(pattern);
  element("pattern-name").textContent = pattern.name.zh;
  element("pattern-name-en").textContent = pattern.name.en.toUpperCase();
  element("pattern-intent").textContent = pattern.intent;
  element("geometry-value").textContent = [...new Set(pattern.emitters.map((emitter) => emitter.geometry.type))]
    .join(" + ").toUpperCase();
  element("emitter-value").textContent = String(pattern.emitters.length).padStart(2, "0");
  element("tick-value").textContent = `${pattern.clock.tickHz} HZ`;
  element("seed-value").textContent = pattern.seed.base.toString(16).slice(-6).toUpperCase();
  element("pattern-sequence").textContent = `${String(index + 1).padStart(2, "0")} / ${patterns.length}`;
  element("room-value").textContent = snapshot.room.replaceAll("_", " ");
  element("warning-shape").textContent = pattern.warning.shape.replaceAll("_", " ").toUpperCase();
}

function selectPattern(index: number): void {
  if (!patternLabMode || simulation === null) return;
  const normalized = (index + patterns.length) % patterns.length;
  patternSelect.value = String(normalized);
  simulation.setPattern(normalized);
  updatePatternPanel(simulation.snapshot());
  audio.setRoom(simulation.snapshot().room);
}

function activeCanonicalPattern(run: CanonicalRunSessionSnapshot): PatternDefinition {
  const patternId = run.roomSampling?.patternId ?? run.adapterPolicy.firstEye.patternId;
  const pattern = patternById.get(patternId);
  if (pattern === undefined) throw new Error(`canonical Run references unknown pattern ${patternId}`);
  return pattern;
}

function canonicalPresentation(run: CanonicalRunSessionSnapshot): SimulationSnapshot {
  return Object.freeze({...projectCanonicalRunSession(run, activeCanonicalPattern(run)), paused});
}

function applyCanonicalPhase(run: CanonicalRunSessionSnapshot): void {
  if (run.phase === canonicalPhase) return;
  canonicalPhase = run.phase;
  document.body.dataset.runPhase = run.phase;
  const activePattern = activeCanonicalPattern(run);
  const patternIndex = patterns.indexOf(activePattern);
  patternSelect.value = String(patternIndex);
  element<HTMLOutputElement>("difficulty-output").value = run.roomSampling?.difficulty
    ?? run.adapterPolicy.firstEye.difficulty;
  difficultyInput.value = "0";

  if (run.phase === "room_sampling") {
    updatePatternPanel(canonicalPresentation(run));
    element("pattern-sequence").textContent = "03 / —";
    element("room-value").textContent = run.roomSampling?.roomId ?? "FORCED_ALIGNMENT";
    audio.setRoom(run.roomSampling?.roomId ?? "FORCED_ALIGNMENT");
  } else if (run.phase === "first_eye" || run.phase === "first_clamp_recovery") {
    updatePatternPanel(canonicalPresentation(run));
    element("pattern-sequence").textContent = "02 / —";
    element("room-value").textContent = run.adapterPolicy.firstEye.roomId;
    audio.setRoom(run.adapterPolicy.firstEye.roomId);
  } else {
    element("pattern-name").textContent = "安静觉醒";
    element("pattern-name-en").textContent = "QUIET AWAKENING";
    // AWAKENING intentionally carries no command text. The only authored
    // discovery prompt is projected separately after its V4 60-second guard.
    element("pattern-intent").textContent = "";
    element("geometry-value").textContent = "MATERIAL";
    element("emitter-value").textContent = "00";
    element("tick-value").textContent = "120 HZ";
    element("warning-shape").textContent = "NONE";
    element("pattern-sequence").textContent = "01 / —";
    element("room-value").textContent = "AWAKENING";
    audio.setRoom("INFORMATION");
  }
  // Pattern metadata carries its own seed base, but the Run surface exposes
  // the reproducible raw Run identity at every phase boundary.
  element("seed-value").textContent = run.rawRunSeed.value
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
}

function projectCanonicalEvents(): void {
  if (!canonicalRun) return;
  const events = canonicalRun.events();
  while (canonicalEventCursor < events.length) {
    const event = events[canonicalEventCursor++];
    if (!event) continue;
    const type = event.id === "projectile.graze.commit"
      ? "graze"
      : event.id === "player.damage.commit"
        ? "damage"
        : event.id === "player.override.local_void.open"
          ? "override"
          : null;
    if (type !== null) {
      logEvent({
        type,
        atMs: event.tick120 * 1000 / MASTER_TICK_HZ,
        detail: event.id,
      });
    }
  }
}

function updateHud(snapshot: SimulationSnapshot, run: CanonicalRunSessionSnapshot | null): void {
  element<HTMLDivElement>("expression-meter").style.width = `${Math.round(snapshot.player.expression * 100)}%`;
  element<HTMLDivElement>("protocol-meter").style.width = `${Math.round(snapshot.protocol * 100)}%`;
  element("evidence-value").textContent = String(snapshot.player.evidence).padStart(2, "0");
  element("health-value").textContent = [0, 1, 2]
    .map((index) => index < snapshot.player.health ? "●" : "○")
    .join(" ");
  element("pattern-time").textContent = (snapshot.patternElapsedMs / 1000)
    .toFixed(3)
    .padStart(6, "0");
  element("header-clock").textContent = ((run ? run.tick120 * 1000 / MASTER_TICK_HZ : snapshot.nowMs) / 1000)
    .toFixed(3).padStart(7, "0");
  warning.classList.toggle(
    "visible",
    patternLabMode
      && snapshot.combatEnabled
      && snapshot.patternElapsedMs < snapshot.pattern.warning.durationMs
      && started,
  );
  document.body.classList.toggle("paused", paused || snapshot.paused);
  if (run) {
    document.body.dataset.authority = run.authority;
    document.body.dataset.authorityTick = String(run.tick120);
    document.body.dataset.rawRunSeedDomain = run.rawRunSeed.domain;
    document.body.dataset.rawRunSeed = String(run.rawRunSeed.value);
    document.body.dataset.firstEyeResolvedSeedDomain = run.firstEyeResolvedSeed.domain;
    document.body.dataset.firstEyeResolvedSeed = String(run.firstEyeResolvedSeed.value);
    document.body.dataset.segmentStartTick = String(run.tick120 - run.segmentTick120);
    document.body.dataset.liveColliders = String(run.combat?.poolUsage.liveColliders ?? 0);
    document.body.dataset.meaningfulInputs = String(run.player.meaningfulInputCount);
    document.body.dataset.signalInputs = String(run.player.signalInputCount);
    document.body.dataset.handoffReady = String(run.handoff.ready);
    document.body.dataset.handoffState = run.handoff.state;
    document.body.dataset.handoffTarget = run.handoff.targetNarrativeState;
    document.body.dataset.handoffAtTick = run.handoff.atTick120 === null
      ? ""
      : String(run.handoff.atTick120);
    document.body.dataset.handoffConsumed = String(run.handoff.consumed);
    document.body.dataset.handoffConsumedAtTick = run.handoff.consumedAtTick120 === null
      ? ""
      : String(run.handoff.consumedAtTick120);
    document.body.dataset.handoffConsumerAuthority = run.handoff.consumerAuthority ?? "";
    document.body.dataset.gazeState = run.gaze.state;
    document.body.dataset.gazeClampCommitted = String(run.handoff.barriers.gazeClampCommitted);
    document.body.dataset.gazeClampReleased = String(run.handoff.barriers.gazeClampReleased);
    document.body.dataset.flowerRecoveryComplete = String(
      run.handoff.barriers.flowerRecoveryComplete,
    );
    document.body.dataset.sourceDrained = String(
      run.handoff.sourceCombat?.projectileLifecycleDrained ?? false,
    );
    document.body.dataset.sourceLiveEntities = run.handoff.sourceCombat === null
      ? ""
      : String(run.handoff.sourceCombat.liveEntities);
    const room = run.roomSampling;
    document.body.dataset.authorityOwner = run.phase === "quiet_awakening"
      ? "quiet_awakening"
      : room === null
        ? "first_eye"
        : room.combat === null
          ? "room_pre_read"
          : room.runCombat.activeOccurrenceId === room.occurrenceId
            ? "room_pattern"
            : room.fixedSliceComplete
              ? "room_post_slice_idle"
              : "room_neutral_tail";
    document.body.dataset.roomId = room?.roomId ?? "";
    document.body.dataset.roomPhase = room?.phase ?? "";
    document.body.dataset.roomStartTick = room === null ? "" : String(room.boundaryTicks120.start);
    document.body.dataset.roomReadStartTick = room === null ? "" : String(room.boundaryTicks120.read);
    document.body.dataset.roomPatternId = room?.patternId ?? "";
    document.body.dataset.roomOccurrenceId = room?.occurrenceId ?? "";
    document.body.dataset.roomTier = room?.tierId ?? "";
    document.body.dataset.roomDifficulty = room?.difficulty ?? "";
    document.body.dataset.roomSelectionAuthority = room?.selectionAuthority ?? "";
    document.body.dataset.roomSelectionRngDraws = room === null ? "" : String(room.selectionRngDraws);
    document.body.dataset.roomComposer = room === null ? "" : String(room.composer);
    document.body.dataset.roomResolvedSeedDomain = room?.resolvedSeed.domain ?? "";
    document.body.dataset.roomResolvedSeed = room === null ? "" : String(room.resolvedSeed.value);
    document.body.dataset.roomCombatPresent = String(room !== null && room.combat !== null);
    document.body.dataset.roomPatternLocalTick = room?.combat === null || room === null
      ? ""
      : String(room.combat.relativeTick120);
    document.body.dataset.roomFixedSliceComplete = room === null
      ? ""
      : String(room.fixedSliceComplete);
    document.body.dataset.roomComplete = room === null ? "" : String(room.roomComplete);
    document.body.dataset.roomHandoffReady = room === null ? "" : String(room.handoffReady);
    document.body.dataset.projectileEntities = String(run.combat?.projectiles.length ?? 0);
    document.body.dataset.residueVisuals = String(run.combat?.poolUsage.residueVisuals ?? 0);
    signalFallback.hidden = !run.discovery.signalFallbackVisible;
  }
  document.body.dataset.clockBacklog = String(authorityClock.snapshot().backlogTicks);
}

async function begin(): Promise<void> {
  if (started) return;
  started = true;
  bootOverlay.classList.add("leaving");
  const room = simulation?.snapshot().room
    ?? canonicalRun?.snapshot().adapterPolicy.firstEye.roomId
    ?? "INFORMATION";
  await audio.unlock(room);
  window.setTimeout(() => bootOverlay.remove(), 520);
  if (patternLabMode) showToast("PATTERN CLOCK / 120 HZ");
}

function configureMode(): void {
  document.body.dataset.mode = patternLabMode ? "pattern-lab" : "run";
  document.body.dataset.presentationProfile = presentationProfile;
  document.title = patternLabMode ? "1bit / STG LAB 04" : "1bit / STG RUN 04";
  const brand = document.querySelector<HTMLAnchorElement>(".brand");
  if (!brand) throw new Error("Missing brand link");
  brand.ariaLabel = patternLabMode ? "1bit STG Lab 首页" : "1bit STG Run 首页";
  element("surface-name").textContent = patternLabMode ? "STG LAB" : "STG RUN";
  const buildTag = document.querySelector<HTMLElement>(".build-tag");
  if (!buildTag) throw new Error("Missing build mode tag");
  buildTag.textContent = patternLabMode ? "LAB" : "RUN";
  const labPanel = document.querySelector<HTMLElement>(".lab-panel");
  if (!labPanel) throw new Error("Missing Lab panel");
  labPanel.hidden = !patternLabMode;
  const controlsStrip = document.querySelector<HTMLElement>(".controls-strip");
  if (!controlsStrip) throw new Error("Missing controls strip");
  controlsStrip.hidden = !patternLabMode;
  warning.hidden = !patternLabMode;
  element("manifest-live-dot").hidden = !patternLabMode;
  element("manifest-status").hidden = !patternLabMode;
  for (const id of ["boot-index", "boot-heading", "boot-description", "boot-meta", "boot-key"]) {
    element(id).hidden = !patternLabMode;
  }
  const bootActionLabel = element<HTMLSpanElement>("boot-action-label");
  bootActionLabel.textContent = patternLabMode ? "进入模拟" : CONTINUE_WITHOUT_MEMORY_COPY.zhCN;
  bootButton.title = patternLabMode ? "ENTER SIMULATION" : CONTINUE_WITHOUT_MEMORY_COPY.en;

  element<HTMLInputElement>("reduced-motion").checked = presentationProfile === "reduced-motion";
  element<HTMLInputElement>("flash-off").checked = presentationProfile === "flash-off";

  patternSelect.disabled = !patternLabMode;
  difficultyInput.disabled = !patternLabMode;
  for (const id of ["previous-pattern", "restart-pattern", "next-pattern"]) {
    element<HTMLButtonElement>(id).disabled = !patternLabMode;
  }
  simulation?.setAutoLoop(true);
}

populatePatternSelect();
configureMode();
if (simulation) {
  const initialPattern = patterns.findIndex((pattern) => pattern.id === "common.graze_calibration");
  selectPattern(initialPattern >= 0 ? initialPattern : 0);
} else if (canonicalRun) {
  applyCanonicalPhase(canonicalRun.snapshot());
}

patternSelect.addEventListener("change", () => selectPattern(Number(patternSelect.value)));
element<HTMLButtonElement>("previous-pattern").addEventListener("click", () => selectPattern(Number(patternSelect.value) - 1));
element<HTMLButtonElement>("next-pattern").addEventListener("click", () => selectPattern(Number(patternSelect.value) + 1));
element<HTMLButtonElement>("restart-pattern").addEventListener("click", () => {
  if (patternLabMode) simulation?.restart();
});
element<HTMLButtonElement>("clear-events").addEventListener("click", () => eventLog.replaceChildren());
difficultyInput.addEventListener("input", (event) => {
  if (!patternLabMode) return;
  const names: Difficulty[] = ["EASY", "NORMAL", "HARD"];
  const value = Number((event.target as HTMLInputElement).value);
  const difficulty = names[value] ?? "NORMAL";
  element<HTMLOutputElement>("difficulty-output").value = difficulty;
  simulation?.setDifficulty(difficulty);
});
element<HTMLInputElement>("audio-enabled").addEventListener("change", (event) => {
  audio.setEnabled((event.target as HTMLInputElement).checked);
});
bootButton.addEventListener("click", () => void begin());
window.addEventListener("keydown", (event) => {
  if (patternLabMode && event.code === "Enter") void begin();
});
window.addEventListener("resize", () => view.resize());

await view.initialize();

let previousTime = performance.now();
const fixedStepMs = 1000 / MASTER_TICK_HZ;

interface AuthorityInputSample {
  readonly controls: InputFrame;
}

let authorityControls: InputFrame = {
  move: {x: 0, y: 0},
  shoot: false,
  focus: false,
  gazeIntent: false,
  overridePressed: false,
  overrideReleased: false,
  overrideHeld: false,
  overrideEdges: [],
  pausePressed: false,
};
const pendingOverrideEdges: Array<"press" | "release"> = [];
let lastCanonicalDirection = {x: 0, y: -1};
let authorityOverrideHeld = false;
let reconcileHeldInputAtWallHead = false;
let discardNextStartedWallInterval = true;

function advanceAuthorityBoundary(boundary: Tick120Boundary<AuthorityInputSample>): void {
  for (const stamped of boundary.inputs) {
    authorityControls = stamped.value.controls;
    pendingOverrideEdges.push(...stamped.value.controls.overrideEdges);
    const canonicalMovement = {
      x: stamped.value.controls.move.x,
      y: -stamped.value.controls.move.y,
    };
    if (Math.hypot(canonicalMovement.x, canonicalMovement.y) > Number.EPSILON) {
      lastCanonicalDirection = canonicalMovement;
    }
  }
  const overrideEdge = pendingOverrideEdges.shift();
  if (overrideEdge !== undefined) authorityOverrideHeld = overrideEdge === "press";
  if (simulation) {
    simulation.step(fixedStepMs, {
      ...authorityControls,
      overridePressed: overrideEdge === "press",
      overrideReleased: overrideEdge === "release",
      overrideEdges: overrideEdge === undefined ? [] : [overrideEdge],
      pausePressed: false,
    });
  } else if (canonicalRun) {
    const canonicalMovement = {
      x: authorityControls.move.x,
      y: -authorityControls.move.y,
    };
    const runBefore = canonicalRun.snapshot();
    const gazeIntentPolicy = runBefore.adapterPolicy.firstEye.gazeIntent;
    const gazeIntentActive = runBefore.phase !== "quiet_awakening"
      && authorityControls.gazeIntent;
    const run = canonicalRun.step({
      tick120: boundary.tick120,
      movement: canonicalMovement,
      signalActive: authorityControls.shoot,
      focused: authorityControls.focus,
      // Browser/device gaze intent is application-authored and remains an
      // explicit sample port. It is independent from Focus, movement and all
      // presentation state.
      gaze: {
        skyEyeVisible: runBefore.phase !== "quiet_awakening",
        pitchDegrees: gazeIntentActive
          ? gazeIntentPolicy.qualifiedPitchDegrees
          : gazeIntentPolicy.neutralPitchDegrees,
        alignment: gazeIntentActive
          ? gazeIntentPolicy.qualifiedAlignment
          : gazeIntentPolicy.neutralAlignment,
      },
      overridePressed: overrideEdge === "press",
      overrideReleased: overrideEdge === "release",
      ...(overrideEdge === "press" ? {overrideDirection: lastCanonicalDirection} : {}),
    });
    applyCanonicalPhase(run);
    projectCanonicalEvents();
  }
  // Edge facts are consumed by exactly one master boundary. Held axes and
  // buttons remain authoritative until a later sampled input replaces them.
  authorityControls = {
    ...authorityControls,
    overridePressed: false,
    overrideReleased: false,
    overrideEdges: [],
    pausePressed: false,
  };
}

const authorityClock = new AuthorityClock<AuthorityInputSample>({
  onTick120: advanceAuthorityBoundary,
});

function frame(time: number): void {
  // AuthorityClock owns the 1024-boundary cap and retains any remaining
  // backlog. Truncating the RAF delta here would silently discard gameplay
  // time after a long frame or background suspension.
  const elapsed = elapsedWallDeltaMs(previousTime, time);
  previousTime = time;
  const runBefore = canonicalRun?.snapshot() ?? null;
  const before = simulation?.snapshot()
    ?? (runBefore === null ? null : canonicalPresentation(runBefore));
  if (before === null) throw new Error("No gameplay authority is configured");
  input.setPlayerPosition(before.player.position);
  const controls = input.poll();
  let controlsForAuthority = controls;
  if (started) {
    // The interval ending at this RAF is traversed under the last sample that
    // existed before it. The newly polled sample can only target a future
    // boundary; it never writes backward across the elapsed interval.
    // At the boot boundary there is no prior gameplay sample at all. Discard
    // that first interval, then seed authority from the current aggregate held
    // state (including a held Override whose pre-start edge was polled away).
    const wallHeadCaughtUp = discardNextStartedWallInterval
      ? true
      : authorityClock.advance(elapsed).backlogTicks === 0;
    if (discardNextStartedWallInterval) {
      discardNextStartedWallInterval = false;
      reconcileHeldInputAtWallHead = true;
    }
    if (!wallHeadCaughtUp) reconcileHeldInputAtWallHead = true;

    if (controls.pausePressed) {
      const wasPaused = paused;
      if (simulation) {
        simulation.togglePause();
        paused = simulation.snapshot().paused;
      } else {
        paused = !paused;
      }
      authorityClock.setPaused(paused);
      if (paused) {
        authorityClock.clearQueuedInputs();
        reconcileHeldInputAtWallHead = true;
        if (wallHeadCaughtUp) {
          pendingOverrideEdges.length = 0;
          authorityControls = {
            move: {x: 0, y: 0},
            shoot: false,
            focus: false,
            gazeIntent: false,
            overridePressed: false,
            overrideReleased: false,
            overrideHeld: false,
            overrideEdges: [],
            pausePressed: false,
          };
        }
      } else if (wasPaused) {
        // The resume-frame interval was offered while the clock was still
        // paused, so AuthorityClock discarded it above. Held input is
        // reconciled only after any older retained backlog has drained.
        reconcileHeldInputAtWallHead = true;
      }
    }

    if (!paused && wallHeadCaughtUp) {
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
      authorityClock.enqueueInput({
        controls: {...controlsForAuthority, pausePressed: false},
      });
    }
  }

  const runSnapshot = canonicalRun?.snapshot() ?? null;
  const snapshot = simulation?.snapshot()
    ?? (runSnapshot === null ? null : canonicalPresentation(runSnapshot));
  if (snapshot === null) throw new Error("No gameplay authority is configured");
  const reducedMotion = presentationProfile === "reduced-motion"
    || element<HTMLInputElement>("reduced-motion").checked
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const flashOff = presentationProfile === "flash-off"
    || element<HTMLInputElement>("flash-off").checked;
  document.body.dataset.reducedMotion = String(reducedMotion);
  document.body.dataset.flashOff = String(flashOff);
  view.render(snapshot, reducedMotion, flashOff);
  canvas.dataset.presentedRoom = snapshot.room;
  canvas.dataset.presentedPatternId = snapshot.pattern.id;
  updateHud(snapshot, runSnapshot);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

let applyWaitingServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
applyWaitingServiceWorkerUpdate = registerSW({
  immediate: true,
  onOfflineReady: () => {
    document.body.dataset.offlineReady = "true";
    if (patternLabMode) showToast("OFFLINE TRACE READY");
  },
  onNeedRefresh: () => {
    document.body.dataset.updateReady = "true";
    // Promoting a waiting worker reloads the page. It is only automatic while
    // the boot boundary still has no gameplay ticks or retained material.
    // During a Run it remains waiting until the player closes/reopens or makes
    // another explicit navigation; no mixed content digest enters this page.
    if (!started && applyWaitingServiceWorkerUpdate) void applyWaitingServiceWorkerUpdate(true);
    else if (patternLabMode) showToast("UPDATE READY · REOPEN");
  },
});
