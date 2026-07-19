import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";
import patternsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import {
  cyclicPresentationEnabled,
  gazeReadingConeForPattern,
  overrideSectorAngles,
  playerFrameForState,
  projectileCausalityFrameForState,
  releaseIndependentSprite,
  replaceIndependentSpriteMaterial,
  targetFrameForPattern,
  targetPositionForPattern,
} from "./renderer";
import type {PatternDefinition} from "./types";

const FIRST_EYE = (patternsManifest.patterns as PatternDefinition[])
  .find((pattern) => pattern.id === "common.eye_acquisition")!;

describe("canonical Override presentation geometry", () => {
  it("projects the authority half-angle as an exact symmetric sector", () => {
    const sector = overrideSectorAngles(24);

    expect(sector.thetaStart).toBeCloseTo(Math.PI / 2 - 24 * Math.PI / 180, 14);
    expect(sector.thetaLength).toBeCloseTo(48 * Math.PI / 180, 14);
    expect(Object.isFrozen(sector)).toBe(true);
  });

  it.each([0, 90, Number.NaN, Number.POSITIVE_INFINITY])(
    "fails closed for an invalid half-angle %s",
    (halfAngleDegrees) => {
      expect(() => overrideSectorAngles(halfAngleDegrees)).toThrow(/half angle/);
    },
  );
});

describe("manifest target presentation position", () => {
  it("projects both First Eye emitter axes through the canonical viewport boundary", () => {
    expect(targetPositionForPattern(FIRST_EYE)).toEqual({x: 0, y: 268.8});
  });

  it("fails closed instead of substituting a non-canonical non-boss anchor", () => {
    const malformed = {
      ...FIRST_EYE,
      emitters: [{...FIRST_EYE.emitters[0], anchor: {space: "pixels", x: 180, y: 51.2}}],
    } as PatternDefinition;
    expect(() => targetPositionForPattern(malformed)).toThrow(/viewport-normalized target anchor/);
  });
});

describe("First Eye V4 material projection", () => {
  it.each([
    [undefined, false, false, 0, "eye.reveal"],
    ["idle", false, false, FIRST_EYE.durationMs, "eye.reveal"],
    ["acquiring", false, false, 0, "eye.reveal"],
    ["clamped", false, false, FIRST_EYE.durationMs, "eye.clamp"],
    ["clamped", false, true, 0, "eye.pressure_hold"],
    ["release-delay", false, false, FIRST_EYE.durationMs, "eye.clamp"],
    ["idle", true, false, 0, "eye.withdraw"],
    ["clamped", true, true, FIRST_EYE.durationMs, "eye.withdraw"],
  ] as const)(
    "maps gaze=%s released=%s reduced=%s at %sms to %s",
    (gazeState, released, reducedMotion, elapsedMs, frame) => {
      expect(FIRST_EYE.warning.durationMs).toBe(601);
      expect(targetFrameForPattern(
        FIRST_EYE,
        elapsedMs,
        gazeState,
        released,
        reducedMotion,
      )).toBe(frame);
    },
  );

  it("does not invent clamp or release from a pattern midpoint or elapsed time", () => {
    const malformed = {
      ...FIRST_EYE,
      timeline: FIRST_EYE.timeline.filter((entry) => entry.event !== "pattern.midpoint"),
    } as PatternDefinition;

    expect(targetFrameForPattern(malformed, 600.999)).toBe("eye.reveal");
    expect(targetFrameForPattern(malformed, FIRST_EYE.durationMs)).toBe("eye.reveal");
  });

  it("derives the non-flashing reading cone from the full motion envelope", () => {
    const cone = gazeReadingConeForPattern(FIRST_EYE);
    expect(cone).not.toBeNull();
    expect(cone?.origin).toEqual({x: 0, y: 268.8});
    expect(cone?.centerAngleRadians).toBeCloseTo(-Math.PI / 2, 14);
    // 96/2 spread + 24 aim + 22*(1380-520)/1000 homing + 0.576 jitter.
    expect(cone?.halfAngleDegrees).toBeCloseTo(91.496, 12);
    expect(cone?.halfAngleRadians).toBeCloseTo(91.496 * Math.PI / 180, 12);
    expect(cone?.radius).toBeGreaterThan(Math.hypot(360, 640));
    expect(cone?.warningDurationMs).toBe(601);
    expect(cone?.collisionEnabled).toBe(false);
    expect(Object.isFrozen(cone)).toBe(true);
    expect(Object.isFrozen(cone?.origin)).toBe(true);
  });

  it("does not manufacture a gaze cone for a differently authored warning", () => {
    const nonGaze = {
      ...FIRST_EYE,
      warning: {...FIRST_EYE.warning, shape: "none"},
    } as PatternDefinition;
    expect(gazeReadingConeForPattern(nonGaze)).toBeNull();
  });
});

describe("V4 player causality frame projection", () => {
  it.each([
    [undefined, false, false, "player.core.idle"],
    ["alive", true, false, "player.focus.confirm_tick"],
    ["dead", true, false, "player.residue_hold"],
    ["dead", false, true, "player.residue_appear"],
    ["respawning", false, false, "player.respawn_asymmetric.frame_04"],
    ["respawning", false, true, "player.respawn_asymmetric.frame_05"],
    ["run-ended", false, true, "player.digital_delete"],
  ] as const)("maps %s (focused=%s, reduced=%s)", (lifeState, focused, reduced, expected) => {
    expect(playerFrameForState(lifeState, focused, reduced)).toBe(expected);
  });
});

describe("EXT-026 projectile causality frame replacement", () => {
  it.each([
    [undefined, undefined, false, null],
    [undefined, true, false, null],
    ["arm", false, false, "cue.projectile.dormant"],
    ["arm", false, true, "enemy_attack.warning_strip"],
    ["flight", true, false, "cue.projectile.armed"],
    ["flight", true, true, "cue.projectile.armed"],
    ["flight", false, false, null],
    ["residue", false, false, null],
  ] as const)(
    "maps lifecycle=%s collision=%s reduced=%s to %s",
    (lifecycleState, collisionEnabled, reducedMotion, expected) => {
      expect(projectileCausalityFrameForState(
        {lifecycleState, collisionEnabled},
        reducedMotion,
      )).toBe(expected);
    },
  );

  it.each([
    ["arm", true],
    ["arm", undefined],
    ["flight", undefined],
    ["residue", true],
    ["residue", undefined],
  ] as const)("fails closed for lifecycle=%s collision=%s", (lifecycleState, collisionEnabled) => {
    expect(() => projectileCausalityFrameForState({lifecycleState, collisionEnabled}))
      .toThrow(/collision/);
  });

  it("clones per-entity material while retaining the shared atlas texture", () => {
    const texture = new THREE.Texture();
    const cached = new THREE.SpriteMaterial({map: texture});
    const first = new THREE.Sprite(new THREE.SpriteMaterial());
    const second = new THREE.Sprite(new THREE.SpriteMaterial());
    const firstPreviousDispose = vi.spyOn(first.material, "dispose");
    const secondPreviousDispose = vi.spyOn(second.material, "dispose");
    const cachedDispose = vi.spyOn(cached, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    replaceIndependentSpriteMaterial(first, cached);
    replaceIndependentSpriteMaterial(second, cached);
    first.material.rotation = 0.5;

    expect(first.material).not.toBe(second.material);
    expect(first.material).not.toBe(cached);
    expect(first.material.map).toBe(texture);
    expect(second.material.map).toBe(texture);
    expect(second.material.rotation).toBe(0);
    expect(firstPreviousDispose).toHaveBeenCalledOnce();
    expect(secondPreviousDispose).toHaveBeenCalledOnce();
    expect(cachedDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
  });
});

describe("presentation accessibility modulation", () => {
  it("removes cyclic modulation for either reduced motion or flash-off", () => {
    expect(cyclicPresentationEnabled(false, false)).toBe(true);
    expect(cyclicPresentationEnabled(true, false)).toBe(false);
    expect(cyclicPresentationEnabled(false, true)).toBe(false);
    expect(cyclicPresentationEnabled(true, true)).toBe(false);
  });
});

describe("transient projectile presentation resources", () => {
  it("disposes the entity material without disposing its shared atlas texture", () => {
    const scene = new THREE.Scene();
    const texture = new THREE.Texture();
    const material = new THREE.SpriteMaterial({map: texture});
    const sprite = new THREE.Sprite(material);
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    scene.add(sprite);

    releaseIndependentSprite(scene, sprite);

    expect(scene.children).not.toContain(sprite);
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).not.toHaveBeenCalled();
  });
});
