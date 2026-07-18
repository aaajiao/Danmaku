import * as THREE from "three";
import coreAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/core-grammar-v3.png?url";
import bossAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/boss-topologies-v3.png?url";
import combatAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/combat-behavior-cues-v4.png?url";
import informationBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/information-gameplay.png?url";
import forcedBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/forced_choice-gameplay.png?url";
import betweenBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/in_between-gameplay.png?url";
import polarizedBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/polarized-gameplay.png?url";
import type {FrameDefinition, SimulationSnapshot} from "./types";

const ATLAS_URLS: Record<string, string> = {
  "core-grammar-v3": coreAtlasUrl,
  "boss-topologies-v3": bossAtlasUrl,
  "combat-behavior-cues-v4": combatAtlasUrl,
};

const BACKGROUND_URLS: Record<string, string> = {
  INFORMATION: informationBackgroundUrl,
  FORCED_ALIGNMENT: forcedBackgroundUrl,
  IN_BETWEEN: betweenBackgroundUrl,
  POLARIZED: polarizedBackgroundUrl,
  COMMON: informationBackgroundUrl,
  TRANSITION: betweenBackgroundUrl,
};

function configureTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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
  private readonly bulletSprites = new Map<number, THREE.Sprite>();
  private readonly shotSprites = new Map<number, THREE.Sprite>();
  private backgroundSprite: THREE.Sprite | null = null;
  private playerSprite: THREE.Sprite | null = null;
  private targetSprite: THREE.Sprite | null = null;
  private currentRoom = "";
  private currentTargetFrame = "";
  private readonly focusRing: THREE.Mesh;
  private readonly overrideWedge: THREE.Mesh;
  private readonly safeGapLines: [THREE.Line, THREE.Line];

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

    this.overrideWedge = new THREE.Mesh(
      new THREE.CircleGeometry(138, 32, Math.PI / 2 - 0.72, 1.44),
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
  }

  async initialize(): Promise<void> {
    const atlasEntries = Object.entries(ATLAS_URLS);
    const backgroundEntries = Object.entries(BACKGROUND_URLS);
    await Promise.all([
      ...atlasEntries.map(async ([id, url]) => {
        this.atlasTextures.set(id, configureTexture(await this.loader.loadAsync(url)));
      }),
      ...backgroundEntries.map(async ([id, url]) => {
        this.backgrounds.set(id, configureTexture(await this.loader.loadAsync(url)));
      }),
    ]);

    this.backgroundSprite = new THREE.Sprite(new THREE.SpriteMaterial({map: this.backgrounds.get("INFORMATION")}));
    this.backgroundSprite.scale.set(360, 640, 1);
    this.backgroundSprite.position.z = -10;
    this.scene.add(this.backgroundSprite);

    this.playerSprite = this.makeSprite("player.core.idle", 128, 3);
    this.scene.add(this.playerSprite);
    this.setTargetFrame("enemy.courier");
    this.resize();
  }

  render(snapshot: SimulationSnapshot, reducedMotion: boolean): void {
    if (!this.playerSprite || !this.targetSprite) return;
    this.updateBackground(snapshot.room);
    this.updateTarget(snapshot);
    this.syncBulletSprites(snapshot);
    this.syncShotSprites(snapshot);

    this.playerSprite.position.set(snapshot.player.position.x, snapshot.player.position.y, 3);
    this.playerSprite.material = this.materialFor(
      snapshot.player.focused ? "player.focus.confirm_tick" : "player.core.idle",
    );
    this.playerSprite.material.opacity = snapshot.player.collisionEnabled ? 1 : 0.55;
    this.focusRing.position.set(snapshot.player.position.x, snapshot.player.position.y, 5);
    this.focusRing.visible = snapshot.player.focused;
    this.targetSprite.visible = snapshot.combatEnabled;

    this.overrideWedge.position.set(snapshot.player.position.x, snapshot.player.position.y, 4);
    this.overrideWedge.visible = snapshot.nowMs < snapshot.overrideUntilMs;
    if (this.overrideWedge.visible && !reducedMotion) {
      this.overrideWedge.rotation.z = Math.sin(snapshot.nowMs * 0.04) * 0.025;
    }

    const path = snapshot.pattern.safeGap.path;
    const phase = path.phase + snapshot.patternElapsedMs / Math.max(1, path.periodMs) * Math.PI * 2;
    const center = path.centerX - 180 + Math.sin(phase) * path.amplitudePx;
    const halfGap = snapshot.pattern.safeGap.minimumWidthPx / 2;
    this.safeGapLines[0].position.x = center - halfGap;
    this.safeGapLines[1].position.x = center + halfGap;
    this.safeGapLines[0].visible = snapshot.combatEnabled;
    this.safeGapLines[1].visible = snapshot.combatEnabled;

    if (!reducedMotion) {
      this.targetSprite.position.y += (240 + Math.sin(snapshot.nowMs * 0.0017) * 4 - this.targetSprite.position.y) * 0.08;
    } else {
      this.targetSprite.position.y = 240;
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio)));
    this.renderer.setSize(width, height, false);
  }

  private updateBackground(room: string): void {
    const normalizedRoom = BACKGROUND_URLS[room] ? room : "INFORMATION";
    if (normalizedRoom === this.currentRoom || !this.backgroundSprite) return;
    this.currentRoom = normalizedRoom;
    this.backgroundSprite.material.map = this.backgrounds.get(normalizedRoom) ?? this.backgrounds.get("INFORMATION") ?? null;
    this.backgroundSprite.material.needsUpdate = true;
  }

  private updateTarget(snapshot: SimulationSnapshot): void {
    const frameId = this.targetFrameFor(snapshot.pattern.id, snapshot.pattern.category);
    if (frameId !== this.currentTargetFrame) this.setTargetFrame(frameId);
    if (!this.targetSprite) return;
    const first = snapshot.pattern.emitters[0];
    const x = snapshot.pattern.category === "BOSS"
      ? 0
      : ((first?.anchor.x ?? 0.5) * 360 - 180);
    this.targetSprite.position.x = x;
    this.targetSprite.scale.setScalar(snapshot.pattern.category === "BOSS" ? 164 : 120);
  }

  private syncBulletSprites(snapshot: SimulationSnapshot): void {
    const active = new Set(snapshot.bullets.map((bullet) => bullet.id));
    for (const [id, sprite] of this.bulletSprites) {
      if (!active.has(id)) {
        this.scene.remove(sprite);
        this.bulletSprites.delete(id);
      }
    }
    for (const bullet of snapshot.bullets) {
      let sprite = this.bulletSprites.get(bullet.id);
      if (!sprite) {
        sprite = this.makeSprite(bullet.archetype, 62, 2, true);
        this.bulletSprites.set(bullet.id, sprite);
        this.scene.add(sprite);
      }
      sprite.position.set(bullet.position.x, bullet.position.y, 2);
      sprite.material.rotation = Math.atan2(bullet.velocity.y, bullet.velocity.x) + Math.PI / 2;
      sprite.material.opacity = snapshot.nowMs >= bullet.armedAtMs ? 1 : 0.34;
    }
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
    sprite.scale.set(size, size, 1);
    sprite.position.z = z;
    return sprite;
  }

  private materialFor(frameId: string): THREE.SpriteMaterial {
    const cached = this.frameMaterials.get(frameId);
    if (cached) return cached;
    const frame = this.frameById.get(frameId) ?? this.frameById.get("bullet.micro.notch_e");
    if (!frame) throw new Error(`Unknown frame: ${frameId}`);
    const source = this.atlasTextures.get(frame.atlas);
    if (!source) throw new Error(`Atlas is not loaded: ${frame.atlas}`);
    const texture = source.clone();
    const [x, y, width, height] = frame.rect;
    texture.repeat.set(width / 1024, height / 1024);
    texture.offset.set(x / 1024, 1 - (y + height) / 1024);
    configureTexture(texture);
    const material = new THREE.SpriteMaterial({map: texture, transparent: true, depthWrite: false});
    this.frameMaterials.set(frameId, material);
    return material;
  }

  private targetFrameFor(patternId: string, category: string): string {
    if (category !== "BOSS") {
      const enemies = ["enemy.courier", "enemy.comparator", "enemy.packet_moth", "enemy.seam_walker"];
      const hash = [...patternId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
      return enemies[hash % enemies.length] ?? "enemy.courier";
    }
    const parts = patternId.split(".");
    const slug = parts[1] ?? "absent_receiver";
    return `boss.${slug}.idle_a`;
  }

  private setTargetFrame(frameId: string): void {
    this.currentTargetFrame = frameId;
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
}
