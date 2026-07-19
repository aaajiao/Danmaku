import * as THREE from "three";
import {
  CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK,
  CANONICAL_RUN_PROJECTILE_V4_FEEDBACK,
  CANONICAL_RUN_ROOM_THRESHOLD_V4_FEEDBACK,
  CANONICAL_RUN_V4_ASSETS,
  canonicalRunAssetRoom,
  canonicalRunRoomThresholdFrame,
} from "../assets/chapters/canonical-run-v4";
import {V4_SHARED_ASSETS} from "../assets/shared-v4";
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

export class GameView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-180, 180, 320, -320, 0.1, 100);
  private readonly loader = new THREE.TextureLoader();
  private readonly frameById = new Map<string, FrameDefinition>();
  private readonly atlasTextures = new Map<string, THREE.Texture>();
  private readonly frameMaterials = new Map<string, THREE.SpriteMaterial>();
  private readonly backgrounds = new Map<string, THREE.Texture>();
  private readonly bulletSprites = new Map<number | string, THREE.Sprite>();
  private readonly shotSprites = new Map<number, THREE.Sprite>();
  private backgroundSprite: THREE.Sprite | null = null;
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
    await Promise.all([
      ...atlasEntries.map(async (asset) => {
        this.atlasTextures.set(asset.id, configureTexture(await this.loader.loadAsync(asset.url)));
      }),
      ...backgroundEntries.map(async (asset) => {
        this.backgrounds.set(asset.id, configureTexture(await this.loader.loadAsync(asset.url)));
      }),
    ]);

    const initialBackground = this.backgrounds.get("INFORMATION");
    if (!initialBackground) throw new Error("Canonical INFORMATION background is not loaded");
    this.backgroundSprite = new THREE.Sprite(new THREE.SpriteMaterial({map: initialBackground}));
    this.backgroundSprite.scale.set(360, 640, 1);
    this.backgroundSprite.position.z = -10;
    this.scene.add(this.backgroundSprite);

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

  render(snapshot: SimulationSnapshot, reducedMotion: boolean, flashOff = false): void {
    if (!this.playerSprite || !this.targetSprite) return;
    const cyclicPresentation = cyclicPresentationEnabled(reducedMotion, flashOff);
    this.updateBackground(snapshot.room);
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
    const cached = this.frameMaterials.get(frameId);
    if (cached) return cached;
    const frame = this.frameById.get(frameId);
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
