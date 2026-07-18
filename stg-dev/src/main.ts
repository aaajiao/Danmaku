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
import {resolveEncounterSeed} from "./authority/encounter-seed";
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

function resolveCanonicalEncounterSeed(params: URLSearchParams): number {
  try {
    return resolveEncounterSeed(params.get("seed"), () => {
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
const firstEyePattern = patterns.find((pattern) => pattern.id === "common.eye_acquisition")
  ?? (() => {
    throw new Error("V4 manifest is missing common.eye_acquisition");
  })();
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
      // The URL seed is already the resolved first-eye encounter seed. V4 does
      // not provide a numeric difficulty salt, so this boundary does not invent one.
      seed: resolveCanonicalEncounterSeed(params),
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

function canonicalPresentation(run: CanonicalRunSessionSnapshot): SimulationSnapshot {
  return Object.freeze({...projectCanonicalRunSession(run, firstEyePattern), paused});
}

function applyCanonicalPhase(run: CanonicalRunSessionSnapshot): void {
  if (run.phase === canonicalPhase) return;
  canonicalPhase = run.phase;
  document.body.dataset.runPhase = run.phase;
  const patternIndex = patterns.indexOf(firstEyePattern);
  patternSelect.value = String(patternIndex);
  element("seed-value").textContent = run.seed.toString(16).padStart(8, "0").toUpperCase();
  element<HTMLOutputElement>("difficulty-output").value = run.adapterPolicy.firstEye.difficulty;
  difficultyInput.value = "0";

  if (run.phase === "first_eye" || run.phase === "first_clamp_recovery") {
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
  const segmentElapsedMs = run ? run.segmentTick120 * 1000 / MASTER_TICK_HZ : snapshot.patternElapsedMs;
  element("pattern-time").textContent = (segmentElapsedMs / 1000).toFixed(3).padStart(6, "0");
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
    document.body.dataset.segmentStartTick = String(run.tick120 - run.segmentTick120);
    document.body.dataset.liveColliders = String(run.combat?.poolUsage.liveColliders ?? 0);
    document.body.dataset.meaningfulInputs = String(run.player.meaningfulInputCount);
    document.body.dataset.signalInputs = String(run.player.signalInputCount);
    document.body.dataset.handoffReady = String(run.handoff.ready);
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
    const run = canonicalRun.step({
      tick120: boundary.tick120,
      movement: canonicalMovement,
      signalActive: authorityControls.shoot,
      focused: authorityControls.focus,
      // Browser/device gaze mapping is not authored by V4. The default Run
      // supplies an explicit neutral sample and therefore cannot manufacture
      // a clamp or advance beyond the First Eye gaze barrier.
      gaze: {
        skyEyeVisible: runBefore.phase !== "quiet_awakening",
        pitchDegrees: 0,
        alignment: 0,
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
