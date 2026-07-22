/**
 * Sparse v4 stage structure — the architectural layer above authored shaders.
 *
 * The fourteen background shaders remain places made of light and motion. This
 * overlay gives the four campaign stages one shared, low-frequency vocabulary:
 * an open gate, a vertical shaft, settling archive slabs, and a closing vault.
 * It deliberately maps only the four stage scenes. Boss scenes map to `none`, so
 * the structure leaves with the same 60-tick transition instead of lingering
 * over a spell-card station that belongs to another picture.
 *
 * This is presentation only. `step()` advances one whole tick and is the only
 * clock; scene names are reconciled by the browser shell exactly like Background.
 * Nothing here can feed back into the simulation (CLAUDE.md rule 1).
 */

import * as THREE from 'three';
import { Layer, type Stage } from '../../render/stage';

export type V4StageStructureRole = 0 | 1 | 2 | 3 | 4;

const ROLE_BY_SCENE: Readonly<Record<string, V4StageStructureRole>> = {
  expanse: 1,
  undertow: 2,
  stratum: 3,
  vault: 4,
};

/** Boss/menu/ending scenes intentionally resolve to no campaign structure. */
export function v4StageStructureRole(scene: string | undefined): V4StageStructureRole {
  if (scene === undefined) return 0;
  return ROLE_BY_SCENE[scene] ?? 0;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = position.xy + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Exported so the no-wall-clock and spatial-frequency contract is testable. */
export const V4_STAGE_STRUCTURE_FRAGMENT = /* glsl */ `
  uniform float uTick;
  uniform float uRole;
  uniform float uPreviousRole;
  uniform float uFade;
  uniform vec2 uRes;
  varying vec2 vUv;

  float band(float distancePx, float halfWidthPx, float softnessPx) {
    return 1.0 - smoothstep(halfWidthPx, halfWidthPx + softnessPx, abs(distancePx));
  }

  float rectMask(vec2 p, vec2 centre, vec2 halfSize, float softnessPx) {
    vec2 d = abs(p - centre) - halfSize;
    float outside = length(max(d, vec2(0.0)));
    return 1.0 - smoothstep(0.0, softnessPx, outside);
  }

  float rectFrame(vec2 p, vec2 centre, vec2 halfSize, float thicknessPx, float softnessPx) {
    float outer = rectMask(p, centre, halfSize, softnessPx);
    vec2 innerHalf = max(halfSize - vec2(thicknessPx), vec2(1.0));
    float inner = rectMask(p, centre, innerHalf, softnessPx);
    return outer * (1.0 - inner);
  }

  vec4 openGate(vec2 p) {
    /* Two broad, almost-black uprights leave the centre genuinely open. */
    float left = rectMask(p, vec2(48.0, uRes.y * 0.48), vec2(18.0, uRes.y * 0.40), 8.0);
    float right = rectMask(p, vec2(uRes.x - 48.0, uRes.y * 0.48), vec2(18.0, uRes.y * 0.40), 8.0);
    float lintel = rectMask(p, vec2(uRes.x * 0.5, 84.0), vec2(uRes.x * 0.34, 6.0), 8.0);

    /* One stage-scale moon: radius ~112px, never an isolated bullet-sized dot. */
    vec2 moonP = p - vec2(uRes.x * 0.50, 162.0);
    float moon = band(length(moonP) - 112.0, 5.0, 7.0);
    float alpha = max(max(left, right) * 0.12, max(lintel * 0.10, moon * 0.085));
    return vec4(vec3(0.055, 0.085, 0.105), alpha);
  }

  vec4 shaft(vec2 p) {
    /* Indigo ribs are long architectural masses, not repeated short ticks. */
    float wallL = rectMask(p, vec2(44.0, uRes.y * 0.5), vec2(22.0, uRes.y * 0.5), 8.0);
    float wallR = rectMask(p, vec2(uRes.x - 44.0, uRes.y * 0.5), vec2(22.0, uRes.y * 0.5), 8.0);
    float innerL = band(p.x - 96.0, 4.0, 5.0);
    float innerR = band(p.x - (uRes.x - 96.0), 4.0, 5.0);

    float descent = mod(p.y + uTick * 0.08, uRes.y + 220.0) - 110.0;
    float longSeal = rectFrame(p, vec2(uRes.x * 0.5, descent), vec2(92.0, 26.0), 6.0, 8.0);
    float alpha = max(max(wallL, wallR) * 0.13, max(innerL, innerR) * 0.075);
    alpha = max(alpha, longSeal * 0.055);
    return vec4(vec3(0.035, 0.045, 0.095), alpha);
  }

  vec4 archive(vec2 p) {
    /* Large paper/stele slabs settle at different depths; no grid or dot field. */
    float drift = mod(uTick * 0.035, 420.0);
    float slabA = rectFrame(p, vec2(68.0, 176.0 + drift), vec2(88.0, 142.0), 14.0, 8.0);
    float slabB = rectFrame(p, vec2(uRes.x - 54.0, 470.0 - drift * 0.55), vec2(104.0, 176.0), 16.0, 9.0);
    float slabC = rectFrame(p, vec2(uRes.x * 0.50, -112.0 + drift * 0.72), vec2(154.0, 74.0), 12.0, 8.0);
    float seamA = band((p.y + drift * 0.3) - 286.0, 12.0, 18.0);
    float alpha = max(max(slabA * 0.075, slabB * 0.09), max(slabC * 0.055, seamA * 0.045));
    return vec4(vec3(0.095, 0.075, 0.060), alpha);
  }

  vec4 closingVault(vec2 p) {
    vec2 centre = vec2(uRes.x * 0.5, 118.0);
    vec2 domeP = vec2(p.x - centre.x, (p.y - centre.y) * 0.72);
    float dome = band(length(domeP) - 258.0, 12.0, 18.0) * step(centre.y - 8.0, p.y);

    /* A broad central oculus and two closing wings preserve one final dark slit. */
    float oculus = band(length(p - vec2(uRes.x * 0.5, 202.0)) - 88.0, 9.0, 14.0);
    float wingL = rectMask(p, vec2(56.0, uRes.y * 0.53), vec2(36.0, 170.0), 12.0);
    float wingR = rectMask(p, vec2(uRes.x - 56.0, uRes.y * 0.53), vec2(36.0, 170.0), 12.0);
    float alpha = max(dome * 0.18, oculus * 0.15);
    alpha = max(alpha, max(wingL, wingR) * 0.16);
    return vec4(vec3(0.105, 0.025, 0.040), alpha);
  }

  vec4 motif(float role, vec2 p) {
    if (role < 0.5) return vec4(0.0);
    if (role < 1.5) return openGate(p);
    if (role < 2.5) return shaft(p);
    if (role < 3.5) return archive(p);
    return closingVault(p);
  }

  void main() {
    vec2 p = vUv * uRes;
    vec4 previous = motif(uPreviousRole, p);
    vec4 current = motif(uRole, p);

    /* Interpolate premultiplied colour so fading to/from NONE stays linear. */
    float alpha = mix(previous.a, current.a, uFade);
    vec3 premultiplied = mix(previous.rgb * previous.a, current.rgb * current.a, uFade);
    vec3 colour = alpha > 0.0001 ? premultiplied / alpha : vec3(0.0);
    gl_FragColor = vec4(colour, alpha);
  }
`;

export class V4StageStructure {
  readonly mesh: THREE.Mesh;

  readonly #geometry: THREE.PlaneGeometry;
  readonly #material: THREE.ShaderMaterial;
  readonly #uTick: THREE.IUniform<number>;
  readonly #uRole: THREE.IUniform<number>;
  readonly #uPreviousRole: THREE.IUniform<number>;
  readonly #uFade: THREE.IUniform<number>;

  #tick = 0;
  #role: V4StageStructureRole;
  #fadeElapsed = 0;
  #fadeTicks = 0;

  constructor(stage: Stage, scene?: string) {
    this.#role = v4StageStructureRole(scene);
    this.#uTick = { value: 0 };
    this.#uRole = { value: this.#role };
    this.#uPreviousRole = { value: this.#role };
    this.#uFade = { value: 1 };

    this.#geometry = new THREE.PlaneGeometry(1, 1);
    this.#material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: V4_STAGE_STRUCTURE_FRAGMENT,
      uniforms: {
        uTick: this.#uTick,
        uRole: this.#uRole,
        uPreviousRole: this.#uPreviousRole,
        uFade: this.#uFade,
        uRes: { value: new THREE.Vector2(stage.width, stage.height) },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.#geometry, this.#material);
    this.mesh.scale.set(stage.width, stage.height, 1);
    this.mesh.position.set(stage.width / 2, stage.height / 2, 0);
    this.mesh.frustumCulled = false;
    stage.add(this.mesh, Layer.BackgroundProps);
  }

  /** Advance the sparse structures by exactly one simulation tick. */
  step(): void {
    this.#tick += 1;
    this.#uTick.value = this.#tick;
    if (this.#fadeTicks <= 0) return;

    this.#fadeElapsed += 1;
    if (this.#fadeElapsed >= this.#fadeTicks) {
      this.#fadeElapsed = 0;
      this.#fadeTicks = 0;
      this.#uPreviousRole.value = this.#role;
      this.#uFade.value = 1;
      return;
    }
    this.#uFade.value = this.#fadeElapsed / this.#fadeTicks;
  }

  /** Reconcile to the structure owned by `scene`, cross-fading in tick space. */
  transitionTo(scene: string | undefined, ticks: number): void {
    const next = v4StageStructureRole(scene);
    if (next === this.#role && this.#fadeTicks === 0) return;

    this.#uPreviousRole.value = this.#role;
    this.#role = next;
    this.#uRole.value = next;
    this.#fadeElapsed = 0;
    this.#fadeTicks = ticks > 0 ? ticks : 0;
    this.#uFade.value = this.#fadeTicks === 0 ? 1 : 0;
    if (this.#fadeTicks === 0) this.#uPreviousRole.value = next;
  }

  get role(): V4StageStructureRole {
    return this.#role;
  }

  dispose(stage: Stage): void {
    stage.remove(this.mesh);
    this.#material.dispose();
    this.#geometry.dispose();
  }
}
