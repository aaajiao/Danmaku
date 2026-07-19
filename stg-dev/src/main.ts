import "./style.css";
import patternsManifest from "../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import frameIndex from "../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import {registerSW} from "virtual:pwa-register";
// Module-scope V4 asset bindings. Importing these runs their fail-fast content
// validation against the immutable V4 kit before anything else boots.
import {V4_SHARED_ASSETS} from "./assets/shared-v4";
import {CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK} from "./assets/chapters/canonical-run-v4";
import {InputManager} from "./game/input";
import {
  projectPresentationSnapshot,
  type PresentationSourceSnapshot,
} from "./game/presentation";
import {GameView} from "./game/renderer";
import type {FrameDefinition, PatternDefinition} from "./game/types";

/*
 * ============================================================================
 * BOOT STUB (rebuild slice S1)
 * ============================================================================
 * The run-orchestration layer is being rebuilt as a thin data-driven conductor
 * over the V4 manifests. This entry point boots the presentation shell only:
 * V4 asset validation, input, renderer, one static frame. The S3 rewrite wires
 * the conductor into the frame loop again.
 *
 * RAF → AuthorityClock BRIDGE SEMANTICS TO PRESERVE IN S3 (proven in the old
 * main.ts; the authority clock itself lives in src/authority/clock.ts):
 *
 * 1. Wall-delta integrity. Every RAF computes
 *    `elapsedWallDeltaMs(previousTime, time)` and feeds the WHOLE delta to
 *    `authorityClock.advance(elapsed)`. Never truncate the RAF delta locally:
 *    AuthorityClock owns the 1024-boundary cap and retains remaining backlog,
 *    so truncating here would silently discard gameplay time after a long
 *    frame or background suspension.
 *
 * 2. Boot-interval discard. The interval ending at the first started RAF has
 *    no prior gameplay sample, so it is discarded once
 *    (`discardNextStartedWallInterval`), and authority input is then seeded
 *    from the current aggregate held state — including a held Override whose
 *    pre-start edge was already polled away.
 *
 * 3. Held-input reconciliation at wall-head. A newly polled sample may only
 *    target a FUTURE boundary; it never writes backward across the elapsed
 *    interval. Whenever the clock is not caught up to the wall head (backlog
 *    ticks > 0), set `reconcileHeldInputAtWallHead`; when caught up again,
 *    clear pending override edges, emit a synthetic press/release only if the
 *    held state differs from authority (`controls.overrideHeld !==
 *    authorityOverrideHeld`), and strip edge facts from the enqueued sample.
 *    Edge facts are consumed by exactly one master boundary; held axes and
 *    buttons remain authoritative until a later sample replaces them.
 *
 * 4. Pause never leaks wall time. On pause: `authorityClock.setPaused(true)`,
 *    clear queued inputs, and (only if the wall head was caught up) zero the
 *    held authority controls and pending edges. On resume: the resume-frame
 *    interval was offered while the clock was still paused and was discarded
 *    by AuthorityClock, so held input is reconciled at the wall head only
 *    after any older retained backlog has drained.
 *
 * 5. registerSW gated on !started. Promoting a waiting service worker reloads
 *    the page, so it is automatic only while the boot boundary has produced no
 *    gameplay ticks and retains no material; during a run it stays waiting
 *    until the player closes/reopens or navigates explicitly.
 * ============================================================================
 */

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing required element #${id}`);
  return value as T;
}

const patterns = patternsManifest.patterns as PatternDefinition[];
const frames = frameIndex.frames as unknown as FrameDefinition[];
const bootPattern = patterns.find((pattern) => pattern.id === "common.eye_acquisition");
if (bootPattern === undefined) {
  throw new Error("V4 pattern manifest is missing common.eye_acquisition");
}

const canvas = element<HTMLCanvasElement>("game-canvas");
const bootButton = element<HTMLButtonElement>("boot-button");
const started = false;

document.body.dataset.mode = "run";
document.title = "1bit / STG RUN 04";
element("surface-name").textContent = "STG RUN";

// V4 content passed its fail-fast validation at import; surface the proof.
document.body.dataset.v4Atlases = String(Object.keys(V4_SHARED_ASSETS.atlases).length);
document.body.dataset.v4FeedbackClampEvent = CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK.clamp.eventId;

// Boot screen status: the run conductor is being rebuilt; no run can start.
const bootDescription = element<HTMLParagraphElement>("boot-description");
bootDescription.hidden = false;
bootDescription.textContent = "运行指挥层正在重建。当前构建只校验 V4 内容并渲染静态画面。";
element<HTMLSpanElement>("boot-action-label").textContent = "运行指挥层重建中";
bootButton.title = "RUN CONDUCTOR REBUILDING";
bootButton.disabled = true;

const input = new InputManager(canvas, (label, connected) => {
  const status = element<HTMLSpanElement>("gamepad-status");
  status.classList.toggle("connected", connected);
  status.textContent = connected ? `● ${label.slice(0, 24)}` : "○ GAMEPAD";
  status.title = connected ? label : "等待标准映射游戏手柄";
});

const view = new GameView(canvas, frames);
window.addEventListener("resize", () => view.resize());
await view.initialize();

// One static presentation frame: quiet shell, no combat, no projectiles.
const bootSource: PresentationSourceSnapshot = {
  tick120: 0,
  relativeTick120: 0,
  patternId: bootPattern.id,
  roomId: "INFORMATION",
  difficulty: "NORMAL",
  projectiles: [],
  combatEnabled: false,
  targetVisible: false,
  player: {
    position: {x: 180, y: 570},
    focused: false,
    damage: null,
    evidence: 0,
    expression: 0.3,
  },
  gazeState: "idle",
  gazeClampReleased: false,
  localVoid: null,
};
const bootSnapshot = projectPresentationSnapshot(bootSource, bootPattern);
input.setPlayerPosition(bootSnapshot.player.position);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.body.dataset.reducedMotion = String(reducedMotion);
document.body.dataset.flashOff = "false";
view.render(bootSnapshot, reducedMotion, false);
canvas.dataset.presentedRoom = bootSnapshot.room;
canvas.dataset.presentedPatternId = bootSnapshot.pattern.id;
element("room-value").textContent = bootSnapshot.room;
element("header-clock").textContent = "000.000";

let applyWaitingServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
applyWaitingServiceWorkerUpdate = registerSW({
  immediate: true,
  onOfflineReady: () => {
    document.body.dataset.offlineReady = "true";
  },
  onNeedRefresh: () => {
    document.body.dataset.updateReady = "true";
    // Promoting a waiting worker reloads the page. It is only automatic while
    // the boot boundary still has no gameplay ticks or retained material (see
    // bridge semantics note 5 above).
    if (!started && applyWaitingServiceWorkerUpdate) void applyWaitingServiceWorkerUpdate(true);
  },
});
