import "./style.css";
import patternsManifest from "../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import composersManifest from "../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import bossesManifest from "../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import frameIndex from "../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import {registerSW} from "virtual:pwa-register";
import {
  AuthorityClock,
  MASTER_TICK_HZ,
  type Tick120Boundary,
} from "./authority/clock";
import {AudioTrace} from "./game/audio";
import {InputManager, type InputFrame} from "./game/input";
import {GameView} from "./game/renderer";
import {
  RunDirector,
  type BossRigManifest,
  type RoomComposerManifest,
  type RunDirectorEvent,
  type RunDirectorSnapshot,
} from "./game/run-director";
import {GameSimulation} from "./game/simulation";
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

function resolveRunSeed(params: URLSearchParams): number {
  const requested = params.get("seed");
  if (requested !== null && requested.trim() !== "") {
    const parsed = Number(requested);
    if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0xffff_ffff) return parsed >>> 0;
  }
  const generated = new Uint32Array(1);
  crypto.getRandomValues(generated);
  return generated[0] ?? 0;
}

function meaningfulAction(input: InputFrame): boolean {
  return Math.hypot(input.move.x, input.move.y) > 0.15
    || input.shoot
    || input.focus
    || input.overridePressed;
}

const params = new URLSearchParams(window.location.search);
const patternLabMode = params.get("mode") === "pattern-lab";
const patterns = patternsManifest.patterns as PatternDefinition[];
const composers = composersManifest as unknown as RoomComposerManifest;
const bosses = bossesManifest as unknown as BossRigManifest;
const frames = frameIndex.frames as unknown as FrameDefinition[];
const canvas = element<HTMLCanvasElement>("game-canvas");
const bootOverlay = element<HTMLDivElement>("boot-overlay");
const bootButton = element<HTMLButtonElement>("boot-button");
const patternSelect = element<HTMLSelectElement>("pattern-select");
const eventLog = element<HTMLOListElement>("event-log");
const warning = element<HTMLDivElement>("warning");
const toast = element<HTMLDivElement>("toast");
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

  if (event.type === "damage") {
    void input.pulse(150, 0.65, 0.35);
    showToast("BODY INTERRUPTED");
  } else if (event.type === "override") {
    void input.pulse(220, 0.25, 0.8);
    showToast("LOCAL VOID / 局部缺席");
  } else if (event.type === "override-denied") {
    void input.pulse(70, 0.08, 0.18);
    showToast("EVIDENCE 需要 03");
  } else if (event.type === "protocol") {
    void input.pulse(180, 0.18, 0.5);
    showToast("PROTOCOL OBSERVED");
  }
}

function logDirectorEvent(event: RunDirectorEvent): void {
  logEvent({
    type: "pattern",
    atMs: event.atMs,
    detail: `run.${event.type} · ${event.segment.kind} · ${event.segment.label.en}`,
  });
  if (event.type === "run.complete") showToast("MATERIAL HANDOFF RECORDED");
}

const simulation = new GameSimulation(patterns, logEvent);
const view = new GameView(canvas, frames);
const runDirector = patternLabMode
  ? null
  : new RunDirector({
      seed: resolveRunSeed(params),
      patterns,
      composers,
      bosses,
      onEvent: logDirectorEvent,
    });
let activeRunSegmentIndex = -1;

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
  if (!patternLabMode) return;
  const normalized = (index + patterns.length) % patterns.length;
  patternSelect.value = String(normalized);
  simulation.setPattern(normalized);
  updatePatternPanel(simulation.snapshot());
  audio.setRoom(simulation.snapshot().room);
}

function applyRunSegment(snapshot: RunDirectorSnapshot): void {
  if (snapshot.segmentIndex === activeRunSegmentIndex) return;
  activeRunSegmentIndex = snapshot.segmentIndex;
  const {segment} = snapshot;
  const patternIndex = segment.patternId
    ? patterns.findIndex((pattern) => pattern.id === segment.patternId)
    : -1;

  if (segment.patternId && patternIndex < 0) throw new Error(`Run references unknown pattern ${segment.patternId}`);
  if (patternIndex >= 0) {
    patternSelect.value = String(patternIndex);
    simulation.configureEncounter(patternIndex, segment.difficulty, segment.combat, segment.room);
    updatePatternPanel(simulation.snapshot());
  } else {
    simulation.setCombatEnabled(false);
    simulation.setEnvironmentRoom(segment.room);
    element("pattern-name").textContent = segment.label.zh;
    element("pattern-name-en").textContent = segment.label.en.toUpperCase();
    element("pattern-intent").textContent = "行为时钟继续记录；发射、碰撞与目标投影暂停。";
    element("geometry-value").textContent = "MATERIAL";
    element("emitter-value").textContent = "00";
    element("tick-value").textContent = "120 HZ";
    element("warning-shape").textContent = "NONE";
  }

  const difficultyIndex = ["EASY", "NORMAL", "HARD"].indexOf(segment.difficulty);
  difficultyInput.value = String(Math.max(0, difficultyIndex));
  element<HTMLOutputElement>("difficulty-output").value = segment.difficulty;
  element("seed-value").textContent = snapshot.seed.toString(16).padStart(8, "0").toUpperCase();
  element("pattern-sequence").textContent = `${String(snapshot.segmentIndex + 1).padStart(2, "0")} / ${runDirector?.schedule.length ?? 1}`;
  element("room-value").textContent = segment.room.replaceAll("_", " ");
  audio.setRoom(segment.room);
}

function updateHud(snapshot: SimulationSnapshot, run: RunDirectorSnapshot | null): void {
  element<HTMLDivElement>("expression-meter").style.width = `${Math.round(snapshot.player.expression * 100)}%`;
  element<HTMLDivElement>("protocol-meter").style.width = `${Math.round(snapshot.protocol * 100)}%`;
  element("evidence-value").textContent = String(snapshot.player.evidence).padStart(2, "0");
  element("health-value").textContent = [0, 1, 2]
    .map((index) => index < snapshot.player.health ? "●" : "○")
    .join(" ");
  const segmentElapsedMs = run?.segmentElapsedMs ?? snapshot.patternElapsedMs;
  element("pattern-time").textContent = (segmentElapsedMs / 1000).toFixed(3).padStart(6, "0");
  element("header-clock").textContent = ((run?.runElapsedMs ?? snapshot.nowMs) / 1000).toFixed(3).padStart(7, "0");
  warning.classList.toggle(
    "visible",
    snapshot.combatEnabled && snapshot.patternElapsedMs < snapshot.pattern.warning.durationMs && started,
  );
  document.body.classList.toggle("paused", snapshot.paused);
}

async function begin(): Promise<void> {
  if (started) return;
  started = true;
  bootOverlay.classList.add("leaving");
  await audio.unlock(simulation.snapshot().room);
  window.setTimeout(() => bootOverlay.remove(), 520);
  showToast(patternLabMode ? "PATTERN CLOCK / 120 HZ" : "RUN CLOCK / 120 HZ");
}

function configureMode(): void {
  document.body.dataset.mode = patternLabMode ? "pattern-lab" : "run";
  document.title = patternLabMode ? "1bit / STG LAB 04" : "1bit / STG RUN 04";
  const buildTag = document.querySelector<HTMLElement>(".build-tag");
  if (!buildTag) throw new Error("Missing build mode tag");
  buildTag.textContent = patternLabMode ? "LAB" : "RUN";

  patternSelect.disabled = !patternLabMode;
  difficultyInput.disabled = !patternLabMode;
  for (const id of ["previous-pattern", "restart-pattern", "next-pattern"]) {
    element<HTMLButtonElement>(id).disabled = !patternLabMode;
  }
  simulation.setAutoLoop(patternLabMode);
}

populatePatternSelect();
configureMode();
if (runDirector) {
  applyRunSegment(runDirector.snapshot());
} else {
  const initialPattern = patterns.findIndex((pattern) => pattern.id === "common.graze_calibration");
  selectPattern(initialPattern >= 0 ? initialPattern : 0);
}

patternSelect.addEventListener("change", () => selectPattern(Number(patternSelect.value)));
element<HTMLButtonElement>("previous-pattern").addEventListener("click", () => selectPattern(Number(patternSelect.value) - 1));
element<HTMLButtonElement>("next-pattern").addEventListener("click", () => selectPattern(Number(patternSelect.value) + 1));
element<HTMLButtonElement>("restart-pattern").addEventListener("click", () => {
  if (patternLabMode) simulation.restart();
});
element<HTMLButtonElement>("clear-events").addEventListener("click", () => eventLog.replaceChildren());
difficultyInput.addEventListener("input", (event) => {
  if (!patternLabMode) return;
  const names: Difficulty[] = ["EASY", "NORMAL", "HARD"];
  const value = Number((event.target as HTMLInputElement).value);
  const difficulty = names[value] ?? "NORMAL";
  element<HTMLOutputElement>("difficulty-output").value = difficulty;
  simulation.setDifficulty(difficulty);
});
element<HTMLInputElement>("audio-enabled").addEventListener("change", (event) => {
  audio.setEnabled((event.target as HTMLInputElement).checked);
});
bootButton.addEventListener("click", () => void begin());
window.addEventListener("keydown", (event) => {
  if (event.code === "Enter") void begin();
});
window.addEventListener("resize", () => view.resize());

await view.initialize();

let previousTime = performance.now();
let meaningfulHeld = false;
const fixedStepMs = 1000 / MASTER_TICK_HZ;

interface AuthorityInputSample {
  readonly controls: InputFrame;
  readonly meaningfulEdge: boolean;
}

let authorityControls: InputFrame = {
  move: {x: 0, y: 0},
  shoot: false,
  focus: false,
  overridePressed: false,
  pausePressed: false,
};

function advanceAuthorityBoundary(boundary: Tick120Boundary<AuthorityInputSample>): void {
  let overridePressed = false;
  let meaningfulInput = false;
  for (const stamped of boundary.inputs) {
    authorityControls = stamped.value.controls;
    overridePressed ||= stamped.value.controls.overridePressed;
    meaningfulInput ||= stamped.value.meaningfulEdge;
  }

  simulation.step(fixedStepMs, {
    ...authorityControls,
    overridePressed,
    pausePressed: false,
  });
  // Edge facts are consumed by exactly one master boundary. Held axes and
  // buttons remain authoritative until a later sampled input replaces them.
  authorityControls = {
    ...authorityControls,
    overridePressed: false,
    pausePressed: false,
  };

  const afterSimulation = simulation.snapshot();
  if (runDirector && !afterSimulation.paused) {
    const run = runDirector.step(fixedStepMs, {
      evidence: afterSimulation.player.evidence,
      meaningfulInput,
    });
    applyRunSegment(run);
  }
}

const authorityClock = new AuthorityClock<AuthorityInputSample>({
  onTick120: advanceAuthorityBoundary,
});

function frame(time: number): void {
  const elapsed = Math.min(100, time - previousTime);
  previousTime = time;
  const controls = input.poll();
  const isMeaningful = meaningfulAction(controls);
  const meaningfulEdge = started && isMeaningful && !meaningfulHeld;
  meaningfulHeld = isMeaningful;

  const before = simulation.snapshot();
  input.setPlayerPosition(before.player.position);
  if (started) {
    if (controls.pausePressed) {
      simulation.togglePause();
      const paused = simulation.snapshot().paused;
      authorityClock.setPaused(paused);
      if (paused) {
        authorityClock.clearQueuedInputs();
        authorityControls = {
          move: {x: 0, y: 0},
          shoot: false,
          focus: false,
          overridePressed: false,
          pausePressed: false,
        };
      }
    }

    if (!simulation.snapshot().paused) {
      authorityClock.enqueueInput({
        controls: {...controls, pausePressed: false},
        meaningfulEdge,
      });
    }
    authorityClock.advance(elapsed);
  }

  const snapshot = simulation.snapshot();
  const runSnapshot = runDirector?.snapshot() ?? null;
  const reducedMotion = element<HTMLInputElement>("reduced-motion").checked;
  view.render(snapshot, reducedMotion);
  updateHud(snapshot, runSnapshot);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

registerSW({
  immediate: true,
  onOfflineReady: () => showToast("OFFLINE TRACE READY"),
  onNeedRefresh: () => showToast("UPDATE READY · RELOAD"),
});
