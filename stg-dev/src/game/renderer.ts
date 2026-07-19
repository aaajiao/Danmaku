import * as THREE from "three";
import {
  CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK,
  CANONICAL_RUN_PROJECTILE_V4_FEEDBACK,
  CANONICAL_RUN_ROOM_THRESHOLD_V4_FEEDBACK,
  CANONICAL_RUN_V4_ASSETS,
  canonicalRunAssetRoom,
  canonicalRunRoomThresholdFrame,
} from "../assets/chapters/canonical-run-v4";
import {
  V4_SHARED_ASSETS,
  v4FrameOrNull,
  v4RoomReaction,
  v4RoomReactionOrNull,
  type V4ReactionOverlay,
  type V4ReactionState,
} from "../assets/shared-v4";
import entityVisualBindingsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/entity-visual-bindings-v4.json";
import ghostReplayContract from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ghost-replay-contract-v4.json";
import type {
  BulletState,
  FrameDefinition,
  PatternDefinition,
  SimulationSnapshot,
  Vec2,
} from "./types";

const FIRST_EYE_PATTERN_ID = "common.eye_acquisition";
const LOGICAL_VIEW_WIDTH = 360;
const LOGICAL_VIEW_HEIGHT = 640;
const GAZE_WARNING_RADIUS = Math.hypot(LOGICAL_VIEW_WIDTH, LOGICAL_VIEW_HEIGHT) + 1;

/** Presentation-only body cadence; never a gameplay clock. */
const PRESENTATION_CYCLE_MS = 120;

function reactionKey(roomId: string, state: string): string {
  return `${roomId}:${state}`;
}

/** Projects a bound V4 frame into the renderer's atlas sub-rect shape. */
function bindingAsFrameDefinition(semanticId: string): FrameDefinition | null {
  const binding = v4FrameOrNull(semanticId);
  if (binding === null) return null;
  const [x, y, width, height] = binding.rect;
  return {
    semanticId: binding.semanticId,
    atlas: binding.atlasId,
    rect: [x, y, width, height],
    logicalSize: binding.logicalSize,
  };
}

function presentationCycleStep(nowMs: number): number {
  if (!Number.isFinite(nowMs) || nowMs < 0) return 0;
  return Math.floor(nowMs / PRESENTATION_CYCLE_MS);
}

function configureTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function overrideSectorAngles(halfAngleDegrees: number): Readonly<{
  thetaStart: number;
  thetaLength: number;
}> {
  if (!Number.isFinite(halfAngleDegrees) || halfAngleDegrees <= 0 || halfAngleDegrees >= 90) {
    throw new Error("Override presentation half angle must be in (0, 90)");
  }
  const halfAngleRadians = halfAngleDegrees * Math.PI / 180;
  return Object.freeze({
    thetaStart: Math.PI / 2 - halfAngleRadians,
    thetaLength: halfAngleRadians * 2,
  });
}

export function cyclicPresentationEnabled(reducedMotion: boolean, flashOff: boolean): boolean {
  return !reducedMotion && !flashOff;
}

/** Releases only the entity-owned material; its cached atlas texture is shared. */
export function releaseIndependentSprite(scene: THREE.Scene, sprite: THREE.Sprite): void {
  scene.remove(sprite);
  sprite.material.dispose();
}

/** Replaces one entity-owned material without mutating or disposing the cached source. */
export function replaceIndependentSpriteMaterial(
  sprite: THREE.Sprite,
  cachedSource: THREE.SpriteMaterial,
): void {
  const previous = sprite.material;
  sprite.material = cachedSource.clone();
  previous.dispose();
}

/** EXT-026: canonical projectile causality follows the final frozen authority snapshot. */
export function projectileCausalityFrameForState(
  projectile: Pick<BulletState, "lifecycleState" | "collisionEnabled">,
  reducedMotion = false,
): string | null {
  const {lifecycleState, collisionEnabled} = projectile;
  if (lifecycleState === undefined) return null;
  if (typeof collisionEnabled !== "boolean") {
    throw new Error(`Canonical projectile ${lifecycleState} requires an explicit collision fact`);
  }
  switch (lifecycleState) {
    case "arm":
      if (collisionEnabled) {
        throw new Error("Canonical projectile arm cannot own collision");
      }
      return reducedMotion
        ? CANONICAL_RUN_PROJECTILE_V4_FEEDBACK.arm.reducedMotionFrameId
        : CANONICAL_RUN_PROJECTILE_V4_FEEDBACK.arm.frameId;
    case "flight":
      return collisionEnabled
        ? CANONICAL_RUN_PROJECTILE_V4_FEEDBACK.live.frameId
        : null;
    case "residue":
      if (collisionEnabled) {
        throw new Error("Canonical projectile residue cannot own collision");
      }
      return null;
    default: {
      const exhaustive: never = lifecycleState;
      throw new Error(`Unknown canonical projectile lifecycle: ${String(exhaustive)}`);
    }
  }
}

export type PresentedPlayerLifeState = "alive" | "dead" | "respawning" | "run-ended";

/** V4 player causality frames are passive projections of the retained life state. */
export function playerFrameForState(
  lifeState: PresentedPlayerLifeState | undefined,
  focused: boolean,
  reducedMotion = false,
): string {
  switch (lifeState) {
    case undefined:
    case "alive":
      return focused ? "player.focus.confirm_tick" : "player.core.idle";
    case "dead":
      return reducedMotion ? "player.residue_appear" : "player.residue_hold";
    case "respawning":
      return reducedMotion
        ? "player.respawn_asymmetric.frame_05"
        : "player.respawn_asymmetric.frame_04";
    case "run-ended":
      return "player.digital_delete";
    default: {
      const exhaustive: never = lifeState;
      throw new Error(`Unknown player life state: ${String(exhaustive)}`);
    }
  }
}

/** First Eye material follows committed gaze authority, never elapsed time. */
export function targetFrameForPattern(
  pattern: PatternDefinition,
  elapsedMs: number,
  gazeState?: SimulationSnapshot["gazeState"],
  gazeClampReleased = false,
  reducedMotion = false,
): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error("Target presentation elapsed time must be finite and non-negative");
  }
  if (pattern.id === FIRST_EYE_PATTERN_ID) {
    if (
      pattern.warning.shape !== "gaze_reading_cone"
      || !Number.isFinite(pattern.warning.durationMs)
      || pattern.warning.durationMs <= 0
    ) {
      throw new Error("First Eye warning contract drifted");
    }
    if (gazeClampReleased) return CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK.release.visual.frameId;
    if (gazeState === "clamped" || gazeState === "release-delay") {
      return reducedMotion
        ? CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK.clamp.visual.reducedMotionFrameId
        : CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK.clamp.visual.frameId;
    }
    return CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK.acquire.visual.frameId;
  }
  if (pattern.category !== "BOSS") {
    const enemies = ["enemy.courier", "enemy.comparator", "enemy.packet_moth", "enemy.seam_walker"];
    const hash = [...pattern.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return enemies[hash % enemies.length] ?? "enemy.courier";
  }
  const parts = pattern.id.split(".");
  const slug = parts[1] ?? "absent_receiver";
  return `boss.${slug}.idle_a`;
}

export interface GazeReadingConeDescriptor {
  readonly origin: Readonly<Vec2>;
  readonly centerAngleRadians: number;
  readonly halfAngleDegrees: number;
  readonly halfAngleRadians: number;
  readonly radius: number;
  readonly warningDurationMs: number;
  readonly collisionEnabled: false;
}

function requiredMotionParameter(
  pattern: PatternDefinition,
  operator: string,
  parameter: string,
): number {
  const motion = pattern.emitters[0]?.motionStack.find((entry) => entry.operator === operator);
  const value = motion?.params[parameter];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Pattern ${pattern.id} requires finite ${operator}.${parameter}`);
  }
  return value;
}

/**
 * Materializes the complete possible First Eye reading envelope: authored arc,
 * maximum aim turn, maximum bounded homing, and the executor's jitter bound.
 */
export function gazeReadingConeForPattern(
  pattern: PatternDefinition,
): Readonly<GazeReadingConeDescriptor> | null {
  if (pattern.warning.shape !== "gaze_reading_cone") return null;
  const emitter = pattern.emitters[0];
  if (!emitter) throw new Error(`Pattern ${pattern.id} requires a gaze emitter`);
  const {baseAngleDeg, spreadDeg} = emitter.geometry;
  if (
    !Number.isFinite(baseAngleDeg)
    || !Number.isFinite(spreadDeg)
    || spreadDeg < 0
    || !Number.isFinite(pattern.warning.durationMs)
    || pattern.warning.durationMs <= 0
  ) {
    throw new Error(`Pattern ${pattern.id} has an invalid gaze warning envelope`);
  }
  const aimTurnDegrees = requiredMotionParameter(pattern, "op.aim_lock", "maxTurnDeg");
  const homingStartMs = requiredMotionParameter(pattern, "op.limited_homing", "startMs");
  const homingEndMs = requiredMotionParameter(pattern, "op.limited_homing", "endMs");
  const homingDegreesPerSecond = requiredMotionParameter(pattern, "op.limited_homing", "maxDegPerSec");
  if (
    aimTurnDegrees < 0
    || homingStartMs < 0
    || homingEndMs < homingStartMs
    || homingDegreesPerSecond < 0
  ) {
    throw new Error(`Pattern ${pattern.id} has an invalid gaze motion bound`);
  }
  const jitterHalfDegrees = Math.min(3, spreadDeg * 0.012) / 2;
  const homingDegrees = homingDegreesPerSecond * (homingEndMs - homingStartMs) / 1000;
  const halfAngleDegrees = spreadDeg / 2 + aimTurnDegrees + homingDegrees + jitterHalfDegrees;
  if (!Number.isFinite(halfAngleDegrees) || halfAngleDegrees <= 0 || halfAngleDegrees >= 180) {
    throw new Error(`Pattern ${pattern.id} gaze warning cannot form a finite sector`);
  }
  const origin = targetPositionForPattern(pattern);
  return Object.freeze({
    origin,
    centerAngleRadians: -baseAngleDeg * Math.PI / 180,
    halfAngleDegrees,
    halfAngleRadians: halfAngleDegrees * Math.PI / 180,
    radius: GAZE_WARNING_RADIUS,
    warningDurationMs: pattern.warning.durationMs,
    collisionEnabled: false,
  });
}

function gazeReadingConeGeometry(descriptor: Readonly<GazeReadingConeDescriptor>): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const addSegment = (fromX: number, fromY: number, toX: number, toY: number): void => {
    points.push(
      new THREE.Vector3(fromX, fromY, 0),
      new THREE.Vector3(toX, toY, 0),
    );
  };
  const {origin, centerAngleRadians, halfAngleRadians, radius} = descriptor;
  for (const angle of [
    centerAngleRadians - halfAngleRadians,
    centerAngleRadians,
    centerAngleRadians + halfAngleRadians,
  ]) {
    addSegment(
      origin.x,
      origin.y,
      origin.x + Math.cos(angle) * radius,
      origin.y + Math.sin(angle) * radius,
    );
  }
  const arcSegments = 48;
  const arcStart = centerAngleRadians - halfAngleRadians;
  for (let index = 0; index < arcSegments; index += 1) {
    const fromAngle = arcStart + halfAngleRadians * 2 * index / arcSegments;
    const toAngle = arcStart + halfAngleRadians * 2 * (index + 1) / arcSegments;
    addSegment(
      origin.x + Math.cos(fromAngle) * radius,
      origin.y + Math.sin(fromAngle) * radius,
      origin.x + Math.cos(toAngle) * radius,
      origin.y + Math.sin(toAngle) * radius,
    );
  }
  // Stable hatches keep the warning readable when color and flashing are absent.
  for (let index = 1; index < 8; index += 1) {
    const angle = arcStart + halfAngleRadians * 2 * index / 8;
    addSegment(
      origin.x + Math.cos(angle) * radius * 0.52,
      origin.y + Math.sin(angle) * radius * 0.52,
      origin.x + Math.cos(angle) * radius * 0.6,
      origin.y + Math.sin(angle) * radius * 0.6,
    );
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

/**
 * Non-boss target sprites materialize the first manifest emitter, so both
 * display axes must cross the same canonical viewport boundary as bullets.
 * Boss topology art remains a centered body projection rather than pretending
 * that one of its potentially offset emitters is the body's authored origin.
 */
export function targetPositionForPattern(pattern: PatternDefinition): Readonly<Vec2> {
  if (pattern.category === "BOSS") return Object.freeze({x: 0, y: 240});
  const anchor = pattern.emitters[0]?.anchor;
  if (
    anchor === undefined
    || anchor.space !== "viewport-normalized"
    || !Number.isFinite(anchor.x)
    || !Number.isFinite(anchor.y)
    || anchor.x < 0
    || anchor.x > 1
    || anchor.y < 0
    || anchor.y > 1
  ) {
    throw new Error(`Pattern ${pattern.id} requires a finite viewport-normalized target anchor`);
  }
  return Object.freeze({
    x: anchor.x * 360 - 180,
    y: 320 - anchor.y * 640,
  });
}

// ---------------------------------------------------------------------------
// Room reaction overlays (backgrounds-v4.json reactionOverlays)
// ---------------------------------------------------------------------------

/**
 * Authoritative facts that can put a room into a reaction state. Every field is
 * a fact the run authority already owns; presentation only reads them.
 */
export interface RoomReactionFacts {
  /** The atomic room-threshold FSM is mid-transition. */
  readonly roomThresholdActive: boolean;
  /** Cross-run material memory is rehydrating into this run. */
  readonly materialMemoryActive: boolean;
  /** The weather scheduler is in its authored `aftermath` phase. */
  readonly weatherAftermathActive: boolean;
  /** The run director has entered dusk. */
  readonly duskActive: boolean;
}

/**
 * Exactly one overlay may show, and V4 authors no precedence, so the rule is
 * stated here rather than invented per call site: the shorter-lived, more
 * discrete world reaction wins over the longer-lived ambient one. A threshold
 * crossing lasts a handful of ticks, a memory rehydrate spans a boot, a weather
 * aftermath spans a cycle tail, and dusk spans the rest of the run. Overlays are
 * switched, never blended, so a total order is required and this is it.
 */
export const ROOM_REACTION_PRECEDENCE: readonly V4ReactionState[] = Object.freeze([
  "threshold",
  "memory",
  "aftermath",
  "dusk",
] as const);

export function roomReactionStateForFacts(
  facts: Readonly<RoomReactionFacts>,
): V4ReactionState | null {
  const held: Readonly<Record<V4ReactionState, boolean>> = {
    threshold: facts.roomThresholdActive,
    memory: facts.materialMemoryActive,
    aftermath: facts.weatherAftermathActive,
    dusk: facts.duskActive,
  };
  for (const state of ROOM_REACTION_PRECEDENCE) {
    if (held[state]) return state;
  }
  return null;
}

/** Resolves the bound overlay asset; a room with no authored overlay stays bare. */
export function roomReactionOverlayForFacts(
  roomId: string,
  facts: Readonly<RoomReactionFacts>,
): Readonly<V4ReactionOverlay> | null {
  const state = roomReactionStateForFacts(facts);
  if (state === null) return null;
  const overlay = v4RoomReactionOrNull(roomId, state);
  if (overlay === null) return null;
  if (overlay.state !== state) {
    throw new Error(`Reaction overlay ${overlay.id} does not carry state ${state}`);
  }
  return overlay;
}

// ---------------------------------------------------------------------------
// Entity visual bindings (entity-visual-bindings-v4.json)
// ---------------------------------------------------------------------------

export type FlowerBand = "QUIET" | "MIDDLE" | "LOUD" | "FOCUS";

export interface EnemyVisualBinding {
  readonly entityId: string;
  readonly bodyFrame: string;
  readonly entryCueFrame: string;
  readonly movementCueFrame: string;
  readonly attackCueFrame: string;
  readonly shutdownCueFrame: string;
  readonly residueFrame: string;
  /** Authored proof that a body sprite swap can never move collision. */
  readonly spriteAnimationMayMoveCollision: false;
}

export interface BossVisualBinding {
  readonly entityId: string;
  readonly baseFrames: readonly string[];
  readonly phaseFrames: readonly string[];
  readonly laserGeometryId: string;
  readonly audioSignalId: string;
  readonly forbiddenLegacyTerminalFrame: string;
  readonly terminalFrame: string;
  readonly materialFrame: string;
}

interface RawEnemyBinding {
  readonly entityId: string;
  readonly bodyFrame: string;
  readonly entryCueFrame: string;
  readonly movementCueFrame: string;
  readonly attackCueFrame: string;
  readonly shutdownCueFrame: string;
  readonly residueFrame: string;
  readonly spriteAnimationMayMoveCollision: boolean;
}

const ENTITY_VISUAL_BINDINGS = entityVisualBindingsManifest as unknown as {
  readonly schemaVersion: string;
  readonly player: {
    readonly bodyFrame: string;
    readonly hitboxFrame: string;
    readonly shotsByFlowerBand: Readonly<Record<string, string>>;
    readonly optionFrames: readonly string[];
    readonly impactFrame: string;
    readonly expressionResidueFrame: string;
  };
  readonly enemies: readonly RawEnemyBinding[];
  readonly bosses: readonly BossVisualBinding[];
};

if (ENTITY_VISUAL_BINDINGS.schemaVersion !== "4.0.0-entity-visual-bindings") {
  throw new Error(
    `Entity visual bindings schema drifted: ${ENTITY_VISUAL_BINDINGS.schemaVersion}`,
  );
}

const enemyBindingsById: ReadonlyMap<string, Readonly<EnemyVisualBinding>> = new Map(
  ENTITY_VISUAL_BINDINGS.enemies.map((entry) => {
    if (entry.spriteAnimationMayMoveCollision !== false) {
      throw new Error(`Enemy ${entry.entityId} claims a sprite may move collision`);
    }
    return [entry.entityId, Object.freeze({...entry, spriteAnimationMayMoveCollision: false as const})];
  }),
);

const bossBindingsById: ReadonlyMap<string, Readonly<BossVisualBinding>> = new Map(
  ENTITY_VISUAL_BINDINGS.bosses.map((entry) => [
    entry.entityId,
    Object.freeze({
      ...entry,
      baseFrames: Object.freeze([...entry.baseFrames]),
      phaseFrames: Object.freeze([...entry.phaseFrames]),
    }),
  ]),
);

/**
 * The manifest forbids the legacy `.death` frames outright, so the renderer
 * refuses them by identity instead of trusting call sites not to ask.
 */
const FORBIDDEN_LEGACY_TERMINAL_FRAMES: ReadonlySet<string> = new Set(
  ENTITY_VISUAL_BINDINGS.bosses.map((entry) => entry.forbiddenLegacyTerminalFrame),
);

export function isForbiddenLegacyTerminalFrame(frameId: string): boolean {
  return FORBIDDEN_LEGACY_TERMINAL_FRAMES.has(frameId);
}

export function playerShotFrameForFlowerBand(band: FlowerBand): string {
  const frameId = ENTITY_VISUAL_BINDINGS.player.shotsByFlowerBand[band];
  if (frameId === undefined) throw new Error(`V4 authors no player shot frame for band ${band}`);
  return frameId;
}

export function playerBodyFrame(): string {
  return ENTITY_VISUAL_BINDINGS.player.bodyFrame;
}

export function enemyVisualBinding(entityId: string): Readonly<EnemyVisualBinding> {
  const binding = enemyBindingsById.get(entityId);
  if (binding === undefined) throw new Error(`V4 authors no enemy visual binding for ${entityId}`);
  return binding;
}

export function bossVisualBinding(canonicalId: string): Readonly<BossVisualBinding> {
  const binding = bossBindingsById.get(canonicalId);
  if (binding === undefined) throw new Error(`V4 authors no boss visual binding for ${canonicalId}`);
  return binding;
}

export type BossPhaseStage = "establish" | "live";

/**
 * Phase 3 authors only `phase3_incomplete`: the boss loop never resolves into a
 * live third phase, so the stage argument cannot manufacture one.
 */
export function bossPhaseFrame(
  canonicalId: string,
  phaseIndex: number,
  stage: BossPhaseStage,
): string {
  const binding = bossVisualBinding(canonicalId);
  if (!Number.isInteger(phaseIndex) || phaseIndex < 1 || phaseIndex > 3) {
    throw new Error(`Boss phase index must be a 1-based integer in [1,3], received ${phaseIndex}`);
  }
  const slug = canonicalId.startsWith("boss.") ? canonicalId.slice("boss.".length) : canonicalId;
  const frameId = phaseIndex === 3
    ? `boss.${slug}.phase3_incomplete`
    : `boss.${slug}.phase${phaseIndex}_${stage}`;
  if (!binding.phaseFrames.includes(frameId)) {
    throw new Error(`Boss ${canonicalId} authors no phase frame ${frameId}`);
  }
  return frameId;
}

/** The authored non-judgment terminal: protocol interrupted, never a death. */
export function bossTerminalFrame(canonicalId: string): string {
  const binding = bossVisualBinding(canonicalId);
  if (isForbiddenLegacyTerminalFrame(binding.terminalFrame)) {
    throw new Error(`Boss ${canonicalId} terminal frame resolved to a forbidden legacy frame`);
  }
  return binding.terminalFrame;
}

// ---------------------------------------------------------------------------
// Weather bodies (presentation-only visual subscribers)
// ---------------------------------------------------------------------------

export type WeatherPresentationPhase = "idle" | "cooldown" | "omen" | "active" | "aftermath";

interface WeatherBodyBinding {
  readonly omenFrame: string;
  readonly activeCycle: readonly string[];
  /** Representative pose used whenever cyclic presentation is withheld. */
  readonly steadyFrame: string;
  /** `null` where V4 authors no aftermath body; absence stays absent. */
  readonly aftermathFrame: string | null;
}

/**
 * Every frame id below is authored in frame-index-v4.json; only the phase join
 * is stated here. WIND authors no aftermath body — wind leaves no trace — so it
 * stays null rather than borrowing another class's residue.
 */
const WEATHER_BODIES: Readonly<Record<string, WeatherBodyBinding>> = Object.freeze({
  STATIC: Object.freeze({
    omenFrame: "weather.static_warning",
    activeCycle: Object.freeze(["weather.static.noise_0", "weather.static.noise_1"]),
    steadyFrame: "weather.static.noise_0",
    aftermathFrame: "weather.static.after",
  }),
  RAIN: Object.freeze({
    omenFrame: "weather.rain_onset",
    activeCycle: Object.freeze(["weather.rain_0", "weather.rain_1", "weather.rain_2"]),
    steadyFrame: "weather.rain_0",
    aftermathFrame: "weather.rain_ash_clear",
  }),
  ASH: Object.freeze({
    omenFrame: "weather.ash_settle",
    activeCycle: Object.freeze(["weather.ash_0", "weather.ash_1", "weather.ash_2"]),
    steadyFrame: "weather.ash_0",
    aftermathFrame: "weather.rain_ash_clear",
  }),
  WIND: Object.freeze({
    omenFrame: "weather.wind_vector",
    activeCycle: Object.freeze(["weather.wind_0", "weather.wind_1", "weather.wind_2"]),
    steadyFrame: "weather.wind_0",
    aftermathFrame: null,
  }),
  ECLIPSE: Object.freeze({
    omenFrame: "weather.eclipse_occlusion",
    activeCycle: Object.freeze(["weather.eclipse_0", "weather.eclipse_1", "weather.eclipse_2"]),
    steadyFrame: "weather.eclipse_0",
    aftermathFrame: "weather.eclipse_release",
  }),
});

export const WEATHER_PRESENTATION_CLASS_IDS: readonly string[] = Object.freeze(
  Object.keys(WEATHER_BODIES).sort(),
);

/**
 * The phase is an authority fact and is the only thing that decides *which*
 * body shows. `cyclic` decides only whether the active body animates within a
 * phase, so withdrawing motion can never move a phase boundary.
 */
export function weatherBodyFrameFor(
  classId: string | null,
  phase: WeatherPresentationPhase,
  cycleStep: number,
  cyclic: boolean,
): string | null {
  if (classId === null) return null;
  const body = WEATHER_BODIES[classId];
  if (body === undefined) throw new Error(`V4 authors no weather body for class ${classId}`);
  switch (phase) {
    case "idle":
    case "cooldown":
      return null;
    case "omen":
      return body.omenFrame;
    case "aftermath":
      return body.aftermathFrame;
    case "active": {
      if (!cyclic) return body.steadyFrame;
      if (!Number.isInteger(cycleStep) || cycleStep < 0) {
        throw new Error(`Weather cycle step must be a non-negative integer, received ${cycleStep}`);
      }
      const frameId = body.activeCycle[cycleStep % body.activeCycle.length];
      if (frameId === undefined) throw new Error(`Weather class ${classId} authors an empty cycle`);
      return frameId;
    }
    default: {
      const exhaustive: never = phase;
      throw new Error(`Unknown weather presentation phase: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Material remainders (player-world-behavior-v4 memory row)
// ---------------------------------------------------------------------------

export type MaterialRemainderKind = "overrideScar" | "deathTrace" | "burnIn" | "ghostResidue";

const MATERIAL_REMAINDER_FRAMES: Readonly<Record<MaterialRemainderKind, string>> = Object.freeze({
  overrideScar: "memory.override_scar",
  deathTrace: "memory.death_trace",
  burnIn: "memory.burnin",
  ghostResidue: "memory.ghost_residue",
});

export function materialRemainderFrame(kind: MaterialRemainderKind): string {
  const frameId = MATERIAL_REMAINDER_FRAMES[kind];
  if (frameId === undefined) throw new Error(`V4 authors no material remainder frame for ${kind}`);
  return frameId;
}

/** Rehydration order is authored by the ghost replay contract, not chosen here. */
export const MATERIAL_REMAINDER_REHYDRATE_ORDER: readonly MaterialRemainderKind[] = Object.freeze(
  (["overrideScar", "deathTrace", "burnIn"] as const).filter((kind) =>
    (ghostReplayContract.ordering as readonly string[]).includes(`${kind}.rehydrate`)),
);

export interface PresentedMaterialRemainder {
  readonly id: string;
  readonly kind: MaterialRemainderKind;
  readonly position: Readonly<Vec2>;
}

// ---------------------------------------------------------------------------
// Ghost replay (ghost-replay-contract-v4.json)
// ---------------------------------------------------------------------------

export interface GhostReplayPoint {
  /** Original gameplay timestamp. Accessibility modes never move this. */
  readonly tMs: number;
  readonly position: Readonly<Vec2>;
  /** True where the capture pinned an authoritative event. */
  readonly eventPin: boolean;
}

/** Structural restatement of the contract's replay clause. */
export const GHOST_REPLAY_PRESENTATION = Object.freeze({
  collisionEnabled: false,
  rewardEnabled: false,
  emitterEnabled: false,
  authority: "visual-subscriber",
} as const);

if (
  ghostReplayContract.replay.collisionClass !== "NONE"
  || ghostReplayContract.replay.rewardClass !== "NONE"
  || ghostReplayContract.replay.emitterClass !== "NONE"
) {
  throw new Error("Ghost replay contract no longer forbids collision, reward and emission");
}

const GHOST_TRAVEL_CYCLE: readonly string[] = Object.freeze(["ghost.walk_a", "ghost.walk_b"]);
const GHOST_PIN_FRAME = "ghost.path_endpoint";
const GHOST_STEADY_FRAME = "ghost.pause";
export const GHOST_RESIDUE_FRAME = "ghost.material_residue";

/**
 * Reduced motion shows event pins and the final point at their original
 * timestamps — the contract's own words. The returned points keep their `tMs`,
 * so every retained sample still lands on the tick it was captured on.
 */
export function ghostReplayPointsForMode(
  points: readonly GhostReplayPoint[],
  reducedMotion: boolean,
): readonly GhostReplayPoint[] {
  if (!reducedMotion) return points;
  const last = points.length - 1;
  return Object.freeze(points.filter((point, index) => point.eventPin || index === last));
}

/** Flash-off is explicitly "same as full motion", so it is not a parameter here. */
export function ghostReplayFrameFor(
  point: Readonly<GhostReplayPoint>,
  cycleStep: number,
  cyclic: boolean,
): string {
  if (point.eventPin) return GHOST_PIN_FRAME;
  if (!cyclic) return GHOST_STEADY_FRAME;
  if (!Number.isInteger(cycleStep) || cycleStep < 0) {
    throw new Error(`Ghost cycle step must be a non-negative integer, received ${cycleStep}`);
  }
  const frameId = GHOST_TRAVEL_CYCLE[cycleStep % GHOST_TRAVEL_CYCLE.length];
  if (frameId === undefined) throw new Error("Ghost travel cycle is empty");
  return frameId;
}

// ---------------------------------------------------------------------------

/**
 * Read-only presentation facts layered on top of the simulation snapshot. Every
 * field is produced by the authority; the renderer never writes back.
 */
export interface PresentationLayerFacts {
  readonly reaction: Readonly<RoomReactionFacts>;
  readonly weather: Readonly<{classId: string | null; phase: WeatherPresentationPhase}>;
  readonly materialRemainders: readonly PresentedMaterialRemainder[];
  readonly ghostReplay: readonly GhostReplayPoint[];
  /** Authority-owned index of the ghost head; presentation never advances it. */
  readonly ghostHeadIndex: number;
}

export class GameView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-180, 180, 320, -320, 0.1, 100);
  private readonly loader = new THREE.TextureLoader();
  private readonly frameById = new Map<string, FrameDefinition>();
  private readonly atlasTextures = new Map<string, THREE.Texture>();
  private readonly frameMaterials = new Map<string, THREE.SpriteMaterial>();
  private readonly backgrounds = new Map<string, THREE.Texture>();
  private readonly reactionTextures = new Map<string, THREE.Texture>();
  private readonly bulletSprites = new Map<number | string, THREE.Sprite>();
  private readonly shotSprites = new Map<number, THREE.Sprite>();
  private readonly remainderSprites = new Map<string, THREE.Sprite>();
  private readonly ghostSprites: THREE.Sprite[] = [];
  private backgroundSprite: THREE.Sprite | null = null;
  private reactionSprite: THREE.Sprite | null = null;
  private weatherSprite: THREE.Sprite | null = null;
  private currentReactionKey = "";
  private currentWeatherFrame = "";
  private roomThresholdSprite: THREE.Sprite | null = null;
  private playerSprite: THREE.Sprite | null = null;
  private targetSprite: THREE.Sprite | null = null;
  private currentRoom = "";
  private currentRoomThresholdFrame = "";
  private currentTargetFrame = "";
  private targetBaseY = 240;
  private readonly focusRing: THREE.Mesh;
  private readonly overrideWedge: THREE.Mesh;
  private overrideHalfAngleDegrees = 45;
  private readonly safeGapLines: [THREE.Line, THREE.Line];
  private readonly gazeWarning: THREE.LineSegments;
  private currentGazeWarningKey = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    frames: FrameDefinition[],
  ) {
    frames.forEach((frame) => this.frameById.set(frame.semanticId, frame));
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: false, powerPreference: "high-performance"});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x08090d, 1);
    this.camera.position.z = 10;

    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(4.5, 5.5, 16),
      new THREE.MeshBasicMaterial({color: 0xefe9da, transparent: true, opacity: 0.85, side: THREE.DoubleSide}),
    );
    this.focusRing.position.z = 5;
    this.scene.add(this.focusRing);

    const initialOverrideAngles = overrideSectorAngles(this.overrideHalfAngleDegrees);
    this.overrideWedge = new THREE.Mesh(
      new THREE.CircleGeometry(138, 32, initialOverrideAngles.thetaStart, initialOverrideAngles.thetaLength),
      new THREE.MeshBasicMaterial({
        color: 0xf02a92,
        transparent: true,
        opacity: 0.17,
        wireframe: true,
        side: THREE.DoubleSide,
      }),
    );
    this.overrideWedge.position.z = 4;
    this.overrideWedge.visible = false;
    this.scene.add(this.overrideWedge);

    const gapMaterial = new THREE.LineBasicMaterial({color: 0x7d8087, transparent: true, opacity: 0.34});
    this.safeGapLines = [this.makeVerticalLine(gapMaterial), this.makeVerticalLine(gapMaterial)];
    this.safeGapLines.forEach((line) => this.scene.add(line));

    this.gazeWarning = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({color: 0xefe9da, transparent: true, opacity: 0.46}),
    );
    this.gazeWarning.position.z = 0.5;
    this.gazeWarning.visible = false;
    this.scene.add(this.gazeWarning);
  }

  async initialize(): Promise<void> {
    const atlasEntries = CANONICAL_RUN_V4_ASSETS.atlasIds.map((id) => {
      const asset = V4_SHARED_ASSETS.atlases[id];
      if (asset === undefined) throw new Error(`Canonical Run atlas is unavailable: ${id}`);
      return asset;
    });
    const backgroundEntries = Object.values(V4_SHARED_ASSETS.backgrounds);
    const reactionEntries = V4_SHARED_ASSETS.roomIds.flatMap((roomId) =>
      V4_SHARED_ASSETS.reactionStates.map((state) => ({
        key: reactionKey(roomId, state),
        asset: v4RoomReaction(roomId, state),
      })));
    await Promise.all([
      ...atlasEntries.map(async (asset) => {
        this.atlasTextures.set(asset.id, configureTexture(await this.loader.loadAsync(asset.url)));
      }),
      ...backgroundEntries.map(async (asset) => {
        this.backgrounds.set(asset.id, configureTexture(await this.loader.loadAsync(asset.url)));
      }),
      ...reactionEntries.map(async ({key, asset}) => {
        this.reactionTextures.set(key, configureTexture(await this.loader.loadAsync(asset.url)));
      }),
    ]);

    const initialBackground = this.backgrounds.get("INFORMATION");
    if (!initialBackground) throw new Error("Canonical INFORMATION background is not loaded");
    this.backgroundSprite = new THREE.Sprite(new THREE.SpriteMaterial({map: initialBackground}));
    this.backgroundSprite.scale.set(360, 640, 1);
    this.backgroundSprite.position.z = -10;
    this.scene.add(this.backgroundSprite);

    // Reaction overlays are binary-alpha material facts: switched, never faded,
    // and always drawn between the base composite and the gameplay sprites.
    this.reactionSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      opacity: 1,
    }));
    this.reactionSprite.scale.set(360, 640, 1);
    this.reactionSprite.position.z = -9;
    this.reactionSprite.visible = false;
    this.scene.add(this.reactionSprite);

    // No arbitrary placeholder frame: the weather body stays unbound and
    // invisible until an authoritative weather phase names one.
    this.weatherSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
    }));
    this.weatherSprite.scale.set(360, 360, 1);
    this.weatherSprite.position.z = 6;
    this.weatherSprite.visible = false;
    this.scene.add(this.weatherSprite);

    this.roomThresholdSprite = this.makeSprite(
      CANONICAL_RUN_ROOM_THRESHOLD_V4_FEEDBACK.fallbackFrameId,
      128,
      0,
    );
    this.roomThresholdSprite.visible = false;
    this.scene.add(this.roomThresholdSprite);

    this.playerSprite = this.makeSprite("player.core.idle", 128, 3);
    this.scene.add(this.playerSprite);
    this.setTargetFrame("enemy.courier");
    this.resize();
  }

  render(
    snapshot: SimulationSnapshot,
    reducedMotion: boolean,
    flashOff = false,
    layers?: Readonly<PresentationLayerFacts>,
  ): void {
    if (!this.playerSprite || !this.targetSprite) return;
    const cyclicPresentation = cyclicPresentationEnabled(reducedMotion, flashOff);
    this.updateBackground(snapshot.room);
    if (layers !== undefined) {
      this.updateReactionOverlay(snapshot.room, layers.reaction);
      this.updateWeatherBody(layers.weather, snapshot.nowMs, cyclicPresentation);
      this.syncMaterialRemainders(layers.materialRemainders);
      this.syncGhostReplay(layers, snapshot.nowMs, reducedMotion, cyclicPresentation);
    }
    this.updateRoomThreshold(snapshot);
    this.updateTarget(snapshot, reducedMotion);
    this.updateGazeWarning(snapshot);
    this.syncBulletSprites(snapshot, reducedMotion);
    this.syncShotSprites(snapshot);

    this.playerSprite.position.set(snapshot.player.position.x, snapshot.player.position.y, 3);
    const lifeState = "lifeState" in snapshot.player
      ? snapshot.player.lifeState as PresentedPlayerLifeState | undefined
      : undefined;
    this.playerSprite.material = this.materialFor(
      playerFrameForState(lifeState, snapshot.player.focused, reducedMotion),
    );
    // Authored causality frames remain materially legible at full opacity.
    // The legacy dim fallback applies only when no non-alive frame is active.
    this.playerSprite.material.opacity = lifeState !== undefined && lifeState !== "alive"
      ? 1
      : snapshot.player.collisionEnabled
        ? 1
        : 0.55;
    this.focusRing.position.set(snapshot.player.position.x, snapshot.player.position.y, 5);
    this.focusRing.visible = snapshot.player.focused && (lifeState === undefined || lifeState === "alive");
    this.targetSprite.visible = snapshot.targetVisible ?? snapshot.combatEnabled;

    this.overrideWedge.position.set(snapshot.player.position.x, snapshot.player.position.y, 4);
    const overrideView = snapshot.overrideView;
    this.overrideWedge.visible = overrideView?.active ?? snapshot.nowMs < snapshot.overrideUntilMs;
    let overrideRotation = 0;
    if (overrideView) {
      this.setOverrideHalfAngle(overrideView.halfAngleDegrees);
      const directionAngle = Math.atan2(overrideView.direction.y, overrideView.direction.x);
      overrideRotation = directionAngle - Math.PI / 2;
      this.overrideWedge.scale.setScalar(overrideView.radius / 138);
    } else {
      this.overrideWedge.scale.setScalar(1);
    }
    if (this.overrideWedge.visible && cyclicPresentation) {
      overrideRotation += Math.sin(snapshot.nowMs * 0.04) * 0.025;
    }
    this.overrideWedge.rotation.z = overrideRotation;

    const path = snapshot.pattern.safeGap.path;
    const phase = path.phase + snapshot.patternElapsedMs / Math.max(1, path.periodMs) * Math.PI * 2;
    const center = snapshot.safeGapCenterX === undefined
      ? path.centerX - 180 + Math.sin(phase) * path.amplitudePx
      : snapshot.safeGapCenterX;
    const halfGap = (snapshot.safeGapWidthPx ?? snapshot.pattern.safeGap.minimumWidthPx) / 2;
    this.safeGapLines[0].position.x = center - halfGap;
    this.safeGapLines[1].position.x = center + halfGap;
    this.safeGapLines[0].visible = snapshot.combatEnabled;
    this.safeGapLines[1].visible = snapshot.combatEnabled;

    const targetMayDrift = cyclicPresentation && snapshot.pattern.warning.shape !== "gaze_reading_cone";
    this.targetSprite.position.y = this.targetBaseY
      + (targetMayDrift ? Math.sin(snapshot.nowMs * 0.0017) * 4 : 0);
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio)));
    this.renderer.setSize(width, height, false);
  }

  private updateBackground(room: string): void {
    const normalizedRoom = canonicalRunAssetRoom(room);
    if (normalizedRoom === this.currentRoom || !this.backgroundSprite) return;
    const background = this.backgrounds.get(normalizedRoom);
    if (!background) throw new Error(`Canonical background is not loaded: ${normalizedRoom}`);
    this.currentRoom = normalizedRoom;
    this.backgroundSprite.material.map = background;
    this.backgroundSprite.material.needsUpdate = true;
  }

  /**
   * Overlay changes are a hard switch. There is no tween, no opacity ramp and
   * no cross-fade: a binary-alpha material fact is either present or it is not.
   */
  private updateReactionOverlay(room: string, facts: Readonly<RoomReactionFacts>): void {
    if (!this.reactionSprite) return;
    const roomId = canonicalRunAssetRoom(room);
    const overlay = roomReactionOverlayForFacts(roomId, facts);
    if (overlay === null) {
      this.reactionSprite.visible = false;
      this.currentReactionKey = "";
      this.canvas.dataset.presentedRoomReaction = "";
      return;
    }
    const key = reactionKey(roomId, overlay.state);
    if (key !== this.currentReactionKey) {
      const texture = this.reactionTextures.get(key);
      if (!texture) throw new Error(`Reaction overlay is not loaded: ${key}`);
      this.reactionSprite.material.map = texture;
      this.reactionSprite.material.needsUpdate = true;
      this.currentReactionKey = key;
    }
    this.reactionSprite.material.opacity = 1;
    this.reactionSprite.visible = true;
    this.canvas.dataset.presentedRoomReaction = key;
  }

  private updateWeatherBody(
    weather: Readonly<{classId: string | null; phase: WeatherPresentationPhase}>,
    nowMs: number,
    cyclic: boolean,
  ): void {
    if (!this.weatherSprite) return;
    const frameId = weatherBodyFrameFor(
      weather.classId,
      weather.phase,
      presentationCycleStep(nowMs),
      cyclic,
    );
    if (frameId === null) {
      // Authored absence: a class with no body for this phase shows nothing.
      this.weatherSprite.visible = false;
      this.canvas.dataset.presentedWeatherFrame = "";
      return;
    }
    if (frameId !== this.currentWeatherFrame) {
      this.weatherSprite.material = this.materialFor(frameId);
      this.currentWeatherFrame = frameId;
    }
    this.weatherSprite.visible = true;
    this.canvas.dataset.presentedWeatherFrame = frameId;
  }

  private syncMaterialRemainders(
    remainders: readonly PresentedMaterialRemainder[],
  ): void {
    const active = new Set(remainders.map((remainder) => remainder.id));
    for (const [id, sprite] of this.remainderSprites) {
      if (!active.has(id)) {
        // Materials here are shared cache entries, so only the node is released.
        this.scene.remove(sprite);
        this.remainderSprites.delete(id);
      }
    }
    for (const remainder of remainders) {
      const frameId = materialRemainderFrame(remainder.kind);
      let sprite = this.remainderSprites.get(remainder.id);
      if (!sprite) {
        sprite = this.makeSprite(frameId, 48, 0);
        this.remainderSprites.set(remainder.id, sprite);
        this.scene.add(sprite);
      } else if (sprite.userData.frameId !== frameId) {
        sprite.material = this.materialFor(frameId);
        sprite.userData.frameId = frameId;
      }
      sprite.position.set(remainder.position.x, remainder.position.y, 0);
    }
    this.canvas.dataset.presentedMaterialRemainders = String(remainders.length);
  }

  /**
   * Ghost points never collide, never reward and never emit. The head index is
   * authority-owned, so this method only chooses which authored pose to show.
   */
  private syncGhostReplay(
    layers: Readonly<PresentationLayerFacts>,
    nowMs: number,
    reducedMotion: boolean,
    cyclic: boolean,
  ): void {
    const points = ghostReplayPointsForMode(layers.ghostReplay, reducedMotion);
    const visible = points.filter((point) => point.tMs <= (layers.ghostReplay[layers.ghostHeadIndex]?.tMs ?? -1));
    while (this.ghostSprites.length > visible.length) {
      const sprite = this.ghostSprites.pop();
      if (sprite) this.scene.remove(sprite);
    }
    const cycleStep = presentationCycleStep(nowMs);
    visible.forEach((point, index) => {
      let sprite = this.ghostSprites[index];
      const frameId = ghostReplayFrameFor(point, cycleStep + index, cyclic);
      if (!sprite) {
        sprite = this.makeSprite(frameId, 40, 0.5);
        this.ghostSprites[index] = sprite;
        this.scene.add(sprite);
      } else if (sprite.userData.frameId !== frameId) {
        sprite.material = this.materialFor(frameId);
        sprite.userData.frameId = frameId;
      }
      sprite.position.set(point.position.x, point.position.y, 0.5);
    });
    this.canvas.dataset.presentedGhostPoints = String(visible.length);
  }

  private updateRoomThreshold(snapshot: SimulationSnapshot): void {
    if (!this.roomThresholdSprite) return;
    const targetRoom = snapshot.roomThresholdTargetRoom;
    if (targetRoom === undefined) {
      this.roomThresholdSprite.visible = false;
      this.canvas.dataset.presentedRoomThresholdFrame = "";
      return;
    }
    const frameId = canonicalRunRoomThresholdFrame(targetRoom);
    if (frameId !== this.currentRoomThresholdFrame) {
      this.currentRoomThresholdFrame = frameId;
      this.roomThresholdSprite.material = this.materialFor(frameId);
    }
    this.roomThresholdSprite.visible = true;
    this.canvas.dataset.presentedRoomThresholdFrame = frameId;
  }

  private updateTarget(snapshot: SimulationSnapshot, reducedMotion: boolean): void {
    const frameId = targetFrameForPattern(
      snapshot.pattern,
      snapshot.patternElapsedMs,
      snapshot.gazeState,
      snapshot.gazeClampReleased,
      reducedMotion,
    );
    if (frameId !== this.currentTargetFrame) this.setTargetFrame(frameId);
    if (!this.targetSprite) return;
    const position = targetPositionForPattern(snapshot.pattern);
    this.targetSprite.position.x = position.x;
    this.targetBaseY = position.y;
    this.targetSprite.scale.setScalar(snapshot.pattern.category === "BOSS" ? 164 : 120);
  }

  private updateGazeWarning(snapshot: SimulationSnapshot): void {
    const descriptor = gazeReadingConeForPattern(snapshot.pattern);
    if (descriptor === null) {
      this.gazeWarning.visible = false;
      return;
    }
    const key = [
      snapshot.pattern.id,
      descriptor.origin.x,
      descriptor.origin.y,
      descriptor.centerAngleRadians,
      descriptor.halfAngleRadians,
      descriptor.radius,
    ].join(":");
    if (key !== this.currentGazeWarningKey) {
      const priorGeometry = this.gazeWarning.geometry;
      this.gazeWarning.geometry = gazeReadingConeGeometry(descriptor);
      this.currentGazeWarningKey = key;
      priorGeometry.dispose();
    }
    this.gazeWarning.visible = snapshot.combatEnabled
      && snapshot.patternElapsedMs >= 0
      && snapshot.patternElapsedMs < descriptor.warningDurationMs;
  }

  private syncBulletSprites(snapshot: SimulationSnapshot, reducedMotion: boolean): void {
    const active = new Set(snapshot.bullets.map((bullet) => bullet.id));
    const causalityFrameCounts = new Map<string, number>();
    for (const [id, sprite] of this.bulletSprites) {
      if (!active.has(id)) {
        // Bullet materials are deliberately cloned because rotation and
        // lifecycle opacity are entity-owned presentation state.
        releaseIndependentSprite(this.scene, sprite);
        this.bulletSprites.delete(id);
      }
    }
    for (const bullet of snapshot.bullets) {
      const causalityFrameId = projectileCausalityFrameForState(bullet, reducedMotion);
      const frameId = causalityFrameId ?? bullet.archetype;
      let sprite = this.bulletSprites.get(bullet.id);
      if (!sprite) {
        sprite = this.makeSprite(frameId, 62, 2, true);
        this.bulletSprites.set(bullet.id, sprite);
        this.scene.add(sprite);
      } else if (sprite.userData.frameId !== frameId) {
        replaceIndependentSpriteMaterial(sprite, this.materialFor(frameId));
        sprite.userData.frameId = frameId;
      }
      sprite.position.set(bullet.position.x, bullet.position.y, 2);
      sprite.material.rotation = Math.atan2(bullet.velocity.y, bullet.velocity.x) + Math.PI / 2;
      // Reduced motion may change interpolation, but V4 does not authorize it
      // to remove the material residue state from presentation.
      sprite.visible = true;
      sprite.material.opacity = causalityFrameId !== null
        ? 1
        : bullet.lifecycleState === "residue"
        ? 0.18
        : bullet.lifecycleState === "arm"
          ? 0.34
          : bullet.lifecycleState === "flight"
            ? 1
            : snapshot.nowMs >= bullet.armedAtMs
            ? 1
            : 0.34;
      if (causalityFrameId !== null) {
        causalityFrameCounts.set(
          causalityFrameId,
          (causalityFrameCounts.get(causalityFrameId) ?? 0) + 1,
        );
      }
    }
    this.canvas.dataset.presentedProjectileCausalityFrames = [...causalityFrameCounts]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([frameId, count]) => `${frameId}=${count}`)
      .join(",");
  }

  private syncShotSprites(snapshot: SimulationSnapshot): void {
    const active = new Set(snapshot.shots.map((shot) => shot.id));
    for (const [id, sprite] of this.shotSprites) {
      if (!active.has(id)) {
        this.scene.remove(sprite);
        this.shotSprites.delete(id);
      }
    }
    const frameId = snapshot.player.focused ? "player_shot.focus_needle" : "player_shot.quiet";
    for (const shot of snapshot.shots) {
      let sprite = this.shotSprites.get(shot.id);
      if (!sprite) {
        sprite = this.makeSprite(frameId, 64, 2.5);
        this.shotSprites.set(shot.id, sprite);
        this.scene.add(sprite);
      }
      sprite.material = this.materialFor(frameId);
      sprite.position.set(shot.position.x, shot.position.y, 2.5);
    }
  }

  private makeSprite(frameId: string, size: number, z: number, independentMaterial = false): THREE.Sprite {
    const material = this.materialFor(frameId);
    const sprite = new THREE.Sprite(independentMaterial ? material.clone() : material);
    sprite.userData.frameId = frameId;
    sprite.scale.set(size, size, 1);
    sprite.position.z = z;
    return sprite;
  }

  private materialFor(frameId: string): THREE.SpriteMaterial {
    if (isForbiddenLegacyTerminalFrame(frameId)) {
      throw new Error(`Forbidden legacy terminal frame requested: ${frameId}`);
    }
    const cached = this.frameMaterials.get(frameId);
    if (cached) return cached;
    // The injected list stays authoritative where it covers a frame; every other
    // frame resolves through the V4 binding layer rather than being invented.
    const frame = this.frameById.get(frameId) ?? bindingAsFrameDefinition(frameId);
    if (!frame) throw new Error(`Unknown frame: ${frameId}`);
    const source = this.atlasTextures.get(frame.atlas);
    if (!source) throw new Error(`Atlas is not loaded: ${frame.atlas}`);
    const atlas = V4_SHARED_ASSETS.atlases[frame.atlas];
    if (!atlas?.size) throw new Error(`Atlas metadata is unavailable: ${frame.atlas}`);
    const [atlasWidth, atlasHeight] = atlas.size;
    const texture = source.clone();
    const [x, y, width, height] = frame.rect;
    texture.repeat.set(width / atlasWidth, height / atlasHeight);
    texture.offset.set(x / atlasWidth, 1 - (y + height) / atlasHeight);
    configureTexture(texture);
    const material = new THREE.SpriteMaterial({map: texture, transparent: true, depthWrite: false});
    this.frameMaterials.set(frameId, material);
    return material;
  }

  private setTargetFrame(frameId: string): void {
    this.currentTargetFrame = frameId;
    this.canvas.dataset.presentedTargetFrame = frameId;
    if (!this.targetSprite) {
      this.targetSprite = this.makeSprite(frameId, 120, 1);
      this.targetSprite.position.set(0, 240, 1);
      this.scene.add(this.targetSprite);
    } else {
      this.targetSprite.material = this.materialFor(frameId);
    }
  }

  private makeVerticalLine(material: THREE.LineBasicMaterial): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -320, 0),
      new THREE.Vector3(0, 320, 0),
    ]);
    const line = new THREE.Line(geometry, material);
    line.position.z = -1;
    return line;
  }

  private setOverrideHalfAngle(halfAngleDegrees: number): void {
    const angles = overrideSectorAngles(halfAngleDegrees);
    if (halfAngleDegrees === this.overrideHalfAngleDegrees) return;
    const priorGeometry = this.overrideWedge.geometry;
    this.overrideWedge.geometry = new THREE.CircleGeometry(
      138,
      32,
      angles.thetaStart,
      angles.thetaLength,
    );
    this.overrideHalfAngleDegrees = halfAngleDegrees;
    priorGeometry.dispose();
  }
}
