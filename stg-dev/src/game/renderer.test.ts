import {readFileSync} from "node:fs";
import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";
import patternsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import entityVisualBindings from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/entity-visual-bindings-v4.json";
import ghostReplayContract from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ghost-replay-contract-v4.json";
import {V4_SHARED_ASSETS, v4FrameOrNull, v4RoomReaction} from "../assets/shared-v4";
import {
  GHOST_REPLAY_PRESENTATION,
  GHOST_RESIDUE_FRAME,
  MATERIAL_REMAINDER_REHYDRATE_ORDER,
  ROOM_REACTION_PRECEDENCE,
  WEATHER_PRESENTATION_CLASS_IDS,
  bossPhaseFrame,
  bossTerminalFrame,
  bossVisualBinding,
  cyclicPresentationEnabled,
  enemyVisualBinding,
  gazeReadingConeForPattern,
  ghostReplayFrameFor,
  ghostReplayPointsForMode,
  isForbiddenLegacyTerminalFrame,
  materialRemainderFrame,
  overrideSectorAngles,
  playerBodyFrame,
  playerFrameForState,
  playerShotFrameForFlowerBand,
  projectileCausalityFrameForState,
  releaseIndependentSprite,
  replaceIndependentSpriteMaterial,
  roomReactionOverlayForFacts,
  roomReactionStateForFacts,
  targetFrameForPattern,
  targetPositionForPattern,
  weatherBodyFrameFor,
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

describe("room reaction overlays", () => {
  it("resolves every room and state to a real bound overlay asset", () => {
    for (const roomId of V4_SHARED_ASSETS.roomIds) {
      for (const state of V4_SHARED_ASSETS.reactionStates) {
        const overlay = v4RoomReaction(roomId, state);
        expect(overlay.state).toBe(state);
        expect(overlay.size).toEqual([360, 640]);
        expect(overlay.url).toMatch(/backgrounds\/reactions\//);
        expect(overlay.visiblePixels).toBeGreaterThan(0);
      }
    }
  });

  it("selects one state by the authored-transience precedence", () => {
    expect(ROOM_REACTION_PRECEDENCE).toEqual(["threshold", "memory", "aftermath", "dusk"]);
    const all = Object.freeze({
      roomThresholdActive: true,
      materialMemoryActive: true,
      weatherAftermathActive: true,
      duskActive: true,
    });
    expect(roomReactionStateForFacts(all)).toBe("threshold");
    expect(roomReactionStateForFacts({...all, roomThresholdActive: false})).toBe("memory");
    expect(roomReactionStateForFacts({
      ...all,
      roomThresholdActive: false,
      materialMemoryActive: false,
    })).toBe("aftermath");
    expect(roomReactionStateForFacts({
      roomThresholdActive: false,
      materialMemoryActive: false,
      weatherAftermathActive: false,
      duskActive: true,
    })).toBe("dusk");
  });

  it("shows no overlay when the world holds no reaction", () => {
    const quiet = Object.freeze({
      roomThresholdActive: false,
      materialMemoryActive: false,
      weatherAftermathActive: false,
      duskActive: false,
    });
    expect(roomReactionStateForFacts(quiet)).toBeNull();
    expect(roomReactionOverlayForFacts("FORCED_ALIGNMENT", quiet)).toBeNull();
  });

  it("resolves the canonical room id through the binding layer, never a naive slug", () => {
    const overlay = roomReactionOverlayForFacts("FORCED_ALIGNMENT", Object.freeze({
      roomThresholdActive: true,
      materialMemoryActive: false,
      weatherAftermathActive: false,
      duskActive: false,
    }));
    expect(overlay?.url).toContain("forced_choice");
    expect(overlay?.id).toBe("reaction.forced_choice.threshold");
  });

  it("does not mutate the frozen authority facts it reads", () => {
    const facts = Object.freeze({
      roomThresholdActive: false,
      materialMemoryActive: true,
      weatherAftermathActive: false,
      duskActive: false,
    });
    expect(roomReactionStateForFacts(facts)).toBe("memory");
    expect(roomReactionStateForFacts(facts)).toBe("memory");
    expect(facts).toEqual({
      roomThresholdActive: false,
      materialMemoryActive: true,
      weatherAftermathActive: false,
      duskActive: false,
    });
  });
});

describe("entity visual bindings", () => {
  it("resolves every authored player flower band to its bound shot frame", () => {
    expect(playerShotFrameForFlowerBand("QUIET")).toBe("player_shot.quiet");
    expect(playerShotFrameForFlowerBand("MIDDLE")).toBe("player_shot.medium_twin");
    expect(playerShotFrameForFlowerBand("LOUD")).toBe("player_shot.loud_open");
    expect(playerShotFrameForFlowerBand("FOCUS")).toBe("player_shot.focus_needle");
    expect(playerBodyFrame()).toBe("player.core.idle");
  });

  it("fails closed instead of substituting a frame for an unauthored band", () => {
    expect(() => playerShotFrameForFlowerBand("SCREAM" as never)).toThrow(/authors no player shot/);
  });

  it("resolves all sixteen enemy archetypes to bound frames that cannot move collision", () => {
    const enemies = entityVisualBindings.enemies;
    expect(enemies).toHaveLength(16);
    for (const entry of enemies) {
      const binding = enemyVisualBinding(entry.entityId);
      expect(binding.spriteAnimationMayMoveCollision).toBe(false);
      for (const frameId of [
        binding.bodyFrame,
        binding.entryCueFrame,
        binding.movementCueFrame,
        binding.attackCueFrame,
        binding.shutdownCueFrame,
        binding.residueFrame,
      ]) {
        expect(v4FrameOrNull(frameId), frameId).not.toBeNull();
      }
    }
  });

  it("resolves all eight bosses and every authored phase frame", () => {
    const bosses = entityVisualBindings.bosses;
    expect(bosses).toHaveLength(8);
    for (const entry of bosses) {
      const binding = bossVisualBinding(entry.entityId);
      for (const frameId of [...binding.baseFrames, ...binding.phaseFrames]) {
        expect(v4FrameOrNull(frameId), frameId).not.toBeNull();
      }
      expect(bossPhaseFrame(entry.entityId, 1, "establish")).toMatch(/\.phase1_establish$/);
      expect(bossPhaseFrame(entry.entityId, 2, "live")).toMatch(/\.phase2_live$/);
      // Phase three is authored as incomplete only; no live third phase exists.
      expect(bossPhaseFrame(entry.entityId, 3, "live")).toMatch(/\.phase3_incomplete$/);
      expect(bossPhaseFrame(entry.entityId, 3, "establish")).toMatch(/\.phase3_incomplete$/);
      expect(bossTerminalFrame(entry.entityId)).toMatch(/\.protocol_interrupted$/);
    }
  });

  it("refuses the legacy terminal frames the manifest forbids", () => {
    for (const entry of entityVisualBindings.bosses) {
      expect(isForbiddenLegacyTerminalFrame(entry.forbiddenLegacyTerminalFrame)).toBe(true);
      expect(entry.forbiddenLegacyTerminalFrame).toMatch(/\.death$/);
    }
    expect(isForbiddenLegacyTerminalFrame("boss.absent_receiver.protocol_interrupted")).toBe(false);
  });

  it("fails closed for an unauthored entity or phase index", () => {
    expect(() => enemyVisualBinding("enemy.invented")).toThrow(/authors no enemy visual binding/);
    expect(() => bossVisualBinding("boss.invented")).toThrow(/authors no boss visual binding/);
    expect(() => bossPhaseFrame("boss.absent_receiver", 0, "live")).toThrow(/1-based integer/);
    expect(() => bossPhaseFrame("boss.absent_receiver", 4, "live")).toThrow(/1-based integer/);
  });
});

describe("weather bodies as visual subscribers", () => {
  it("binds every authored weather class to real frames", () => {
    expect(WEATHER_PRESENTATION_CLASS_IDS).toEqual(["ASH", "ECLIPSE", "RAIN", "STATIC", "WIND"]);
    for (const classId of WEATHER_PRESENTATION_CLASS_IDS) {
      for (const phase of ["omen", "active", "aftermath"] as const) {
        const frameId = weatherBodyFrameFor(classId, phase, 0, true);
        if (frameId === null) continue;
        expect(v4FrameOrNull(frameId), frameId).not.toBeNull();
      }
    }
  });

  it("shows no body outside an authored weather phase", () => {
    expect(weatherBodyFrameFor("RAIN", "idle", 0, true)).toBeNull();
    expect(weatherBodyFrameFor("RAIN", "cooldown", 0, true)).toBeNull();
    expect(weatherBodyFrameFor(null, "active", 0, true)).toBeNull();
  });

  it("leaves WIND's unauthored aftermath absent rather than borrowing a residue", () => {
    expect(weatherBodyFrameFor("WIND", "aftermath", 0, true)).toBeNull();
    expect(weatherBodyFrameFor("STATIC", "aftermath", 0, true)).toBe("weather.static.after");
    expect(weatherBodyFrameFor("ECLIPSE", "aftermath", 0, true)).toBe("weather.eclipse_release");
  });

  it("holds one representative pose when cyclic presentation is withheld", () => {
    const steps = [0, 1, 2, 3, 4, 5];
    expect(steps.map((step) => weatherBodyFrameFor("RAIN", "active", step, false)))
      .toEqual(Array.from({length: 6}, () => "weather.rain_0"));
    expect(steps.map((step) => weatherBodyFrameFor("RAIN", "active", step, true)))
      .toEqual([
        "weather.rain_0",
        "weather.rain_1",
        "weather.rain_2",
        "weather.rain_0",
        "weather.rain_1",
        "weather.rain_2",
      ]);
  });

  it("keeps every phase boundary at an identical time in all accessibility modes", () => {
    const timeline: Array<[number, "idle" | "omen" | "active" | "aftermath" | "cooldown"]> = [
      [0, "idle"], [1, "idle"], [2, "omen"], [3, "omen"], [4, "active"],
      [5, "active"], [6, "active"], [7, "aftermath"], [8, "cooldown"],
    ];
    const boundaries = (cyclic: boolean): number[] => {
      const changes: number[] = [];
      let previous: string | null | undefined;
      for (const [step, phase] of timeline) {
        const frameId = weatherBodyFrameFor("ECLIPSE", phase, step, cyclic);
        const presence = frameId === null ? null : phase;
        if (previous !== undefined && presence !== previous) changes.push(step);
        previous = presence;
      }
      return changes;
    };

    expect(boundaries(true)).toEqual(boundaries(false));
    expect(boundaries(false)).toEqual([2, 4, 7, 8]);
  });

  it("fails closed for an unauthored weather class or a negative cycle step", () => {
    expect(() => weatherBodyFrameFor("SNOW", "active", 0, true)).toThrow(/authors no weather body/);
    expect(() => weatherBodyFrameFor("RAIN", "active", -1, true)).toThrow(/non-negative integer/);
  });
});

describe("material remainders", () => {
  it("binds each remainder kind to its authored memory frame", () => {
    const kinds = ["overrideScar", "deathTrace", "burnIn", "ghostResidue"] as const;
    const expected = [
      "memory.override_scar",
      "memory.death_trace",
      "memory.burnin",
      "memory.ghost_residue",
    ];
    expect(kinds.map((kind) => materialRemainderFrame(kind))).toEqual(expected);
    for (const frameId of expected) {
      expect(v4FrameOrNull(frameId), frameId).not.toBeNull();
    }
  });

  it("takes its rehydrate order from the ghost replay contract", () => {
    expect(MATERIAL_REMAINDER_REHYDRATE_ORDER).toEqual(["overrideScar", "deathTrace", "burnIn"]);
    const ordering = ghostReplayContract.ordering as readonly string[];
    const positions = MATERIAL_REMAINDER_REHYDRATE_ORDER
      .map((kind) => ordering.indexOf(`${kind}.rehydrate`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });

  it("fails closed for an unauthored remainder kind", () => {
    expect(() => materialRemainderFrame("scoreStreak" as never))
      .toThrow(/authors no material remainder frame/);
  });
});

describe("ghost replay presentation", () => {
  const points = Object.freeze([
    {tMs: 0, position: {x: 0, y: -200}, eventPin: true},
    {tMs: 120, position: {x: 10, y: -180}, eventPin: false},
    {tMs: 240, position: {x: 20, y: -160}, eventPin: false},
    {tMs: 360, position: {x: 30, y: -140}, eventPin: true},
    {tMs: 480, position: {x: 40, y: -120}, eventPin: false},
  ]);

  it("never collides, rewards or emits", () => {
    expect(GHOST_REPLAY_PRESENTATION.collisionEnabled).toBe(false);
    expect(GHOST_REPLAY_PRESENTATION.rewardEnabled).toBe(false);
    expect(GHOST_REPLAY_PRESENTATION.emitterEnabled).toBe(false);
    expect(ghostReplayContract.replay.collisionClass).toBe("NONE");
    expect(ghostReplayContract.replay.rewardClass).toBe("NONE");
    expect(ghostReplayContract.replay.emitterClass).toBe("NONE");
  });

  it("keeps event pins and the final point at their original timestamps", () => {
    const reduced = ghostReplayPointsForMode(points, true);

    expect(reduced.map((point) => point.tMs)).toEqual([0, 360, 480]);
    // Every retained point keeps the exact object the capture produced.
    for (const point of reduced) expect(points).toContain(point);
    expect(ghostReplayPointsForMode(points, false)).toBe(points);
  });

  it("binds ghost poses to real frames and holds one pose without cyclic motion", () => {
    for (const frameId of ["ghost.walk_a", "ghost.walk_b", "ghost.pause", "ghost.path_endpoint", GHOST_RESIDUE_FRAME]) {
      expect(v4FrameOrNull(frameId), frameId).not.toBeNull();
    }
    expect(ghostReplayFrameFor(points[3]!, 0, true)).toBe("ghost.path_endpoint");
    expect(ghostReplayFrameFor(points[3]!, 7, false)).toBe("ghost.path_endpoint");
    expect([0, 1, 2, 3].map((step) => ghostReplayFrameFor(points[1]!, step, true)))
      .toEqual(["ghost.walk_a", "ghost.walk_b", "ghost.walk_a", "ghost.walk_b"]);
    expect([0, 1, 2, 3].map((step) => ghostReplayFrameFor(points[1]!, step, false)))
      .toEqual(Array.from({length: 4}, () => "ghost.pause"));
  });

  it("keeps every event pin on the same timestamp in both motion modes", () => {
    const pinTimes = (reducedMotion: boolean): number[] =>
      ghostReplayPointsForMode(points, reducedMotion)
        .filter((point) => point.eventPin)
        .map((point) => point.tMs);

    expect(pinTimes(true)).toEqual(pinTimes(false));
  });
});

describe("renderer draw-path discipline", () => {
  const source = readFileSync(new URL("./renderer.ts", import.meta.url), "utf8");

  it("never reaches for a nondeterministic clock or randomness", () => {
    expect(source).not.toMatch(/Date\.now|Math\.random|performance\.now/);
  });

  it("carries no judgment vocabulary", () => {
    expect(source).not.toMatch(/\b(score|rank|grade|leaderboard|victory|defeat|good_end|bad_end)\b/i);
  });

  it("keeps OVERRIDE_MAGENTA out of any full-screen surface", () => {
    // The magenta wedge is a scar-write marker: bounded radius, wireframe, and
    // never applied to the background, reaction overlay or weather planes.
    const fullScreenPlanes = source.slice(source.indexOf("this.reactionSprite = new THREE.Sprite"));
    expect(fullScreenPlanes).not.toMatch(/0xf02a92/);
  });

  it("switches reaction overlays instead of fading them", () => {
    expect(source).toMatch(/this\.reactionSprite\.material\.opacity = 1;/);
    expect(source.slice(source.indexOf("private updateReactionOverlay")))
      .not.toMatch(/lerp|damp|fade|crossfade/i);
  });

  it("resolves every presentation frame through the V4 binding layer", () => {
    const invented = [...source.matchAll(/"(weather|memory|ghost)\.[a-z0-9._]+"/g)]
      .map((match) => match[0].slice(1, -1))
      .filter((frameId) => v4FrameOrNull(frameId) === null);
    expect(invented).toEqual([]);
  });
});
