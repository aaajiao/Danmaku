import {describe, expect, it} from "vitest";
import patternStructureReportJson from "../../../1bit-stg-complete-asset-kit-v4/gameplay/reports/pattern-structure-signatures-v4.json";
import safeGapReportJson from "../../../1bit-stg-complete-asset-kit-v4/gameplay/reports/safe-gap-report-v4.json";
import {AuthorityClock} from "./clock";
import {CanonicalEventBus} from "./events";
import {
  BossPhaseAuthority,
  defaultEncounterManifestSource,
  validateEncounterAuthorityManifests,
  type EncounterManifestSource,
} from "./encounters";
import {LaserAuthority, compileLaserGeometry} from "./lasers";
import {sweepSegmentIntoSector} from "./player";
import {
  createPatternSchedule,
  executablePattern,
  geometryCandidates,
  PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND,
  PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND,
  roundPatternCount,
  safeGapCenter,
  safeGapWidth,
  sha256,
  simulatePattern,
} from "./pattern-executor";
import {
  CanonicalCombatKernel,
  CanonicalMisreaderEnforceEntryFragment,
  SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS,
  crossedTickCount,
  commitBossPhaseExitWithLaserStart,
  sweepMovingProjectileAgainstPlayer,
  validateAbsentReceiverObserveRigContract,
  validateAlternatingVerdictPatternContract,
  validateAshMemoryPatternContract,
  validateBallotShiftPatternContract,
  validateBossObservePhaseContract,
  validateClockDecreePatternContract,
  validateContextSwitchPatternContract,
  validateCrackFallLoopPatternContract,
  validateDuskSettlePatternContract,
  validateDualClockGateParameters,
  validateGridGeometryContract,
  validateHistoryReplayParameters,
  validateLatticeGeometryContract,
  validateLineGeometryContract,
  validateLateralWallParameters,
  validateLocalVectorBiasParameters,
  validateNoDuskGridPatternContract,
  validateOneSunOneRuleObserveRigContract,
  validateOneSunOneRulePatternContract,
  validateOverrideVoidPatternContract,
  validatePairedFanGeometryContract,
  validatePiecewiseLinearSpeedCurveParameters,
  validateRainPacketsWeatherEchoContract,
  validateRingGeometryContract,
  validateRoomThresholdPatternContract,
  validateStableIntersectionPatternContract,
  validateSeamTransformParameters,
  validateSpeedEnvelopeParameters,
  validateTurnOnceParameters,
  validateWallGeometryContract,
  type CanonicalCombatStepInput,
  type CanonicalCombatPatternId,
} from "./combat-kernel";

const OPTIONS = Object.freeze({
  seed: 0x1b17c0de,
  startTick120: 0,
  roomId: "INFORMATION",
  difficulty: "NORMAL" as const,
  grazeRadiusPx: 18,
  projectileDamage: 1,
  projectilePoolClasses: Object.freeze({"bullet.micro.notch_e": "micro" as const}),
});
const UNANSWERING_FEED_REPORT_SEED = 516003696;
const UNSTABLE_MIDDLE_REPORT_SEED = 1610616880;
const HARD_CUT_REPORT_SEED = 3982869609;
const STALE_PACKET_RETRY_REPORT_SEED = 2259046056;
const ABSENT_RECEIVER_QUERY_REPORT_SEED = 3098160946;
const NOTIFICATION_OVERFLOW_REPORT_SEED = 1205726097;
const RAIN_PACKETS_REPORT_SEED = 1771193663;
const WIND_BIAS_REPORT_SEED = 1709394890;
const DUSK_SETTLE_REPORT_SEED = 924053617;
const CRACK_FALL_LOOP_REPORT_SEED = 3074674485;
const CONTEXT_SWITCH_REPORT_SEED = 2740011774;
const BALLOT_SHIFT_REPORT_SEED = 1912173942;
const OVERRIDE_VOID_REPORT_SEED = 1930559651;
const ALTERNATING_VERDICT_REPORT_SEED = 4224146597;
const ONE_SUN_ONE_RULE_REPORT_SEED = 2689482836;
const CLOCK_DECREE_REPORT_SEED = 1517218079;
const NO_DUSK_GRID_REPORT_SEED = 2541744056;
const ROOM_THRESHOLD_REPORT_SEED = 577554878;
const STABLE_INTERSECTION_REPORT_SEED = 3179523623;
const ASH_MEMORY_REPORT_SEED = 2725930629;

function inputAt(tick120: number): CanonicalCombatStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    focused: tick120 % 240 < 80,
  };
}

function safeGapFollowingInput(
  kernel: CanonicalCombatKernel,
  pattern: ReturnType<typeof executablePattern>,
  tick120: number,
): CanonicalCombatStepInput {
  const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
  const targetX = safeGapCenter(pattern, tick120 * 1000 / 120);
  const currentX = kernel.snapshot().playerPosition.x;
  return {
    tick120,
    movement: {
      x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
      y: 0,
    },
    focused: false,
  };
}

function runTo(targetTick120: number): CanonicalCombatKernel {
  const kernel = new CanonicalCombatKernel(OPTIONS);
  for (let tick120 = 1; tick120 <= targetTick120; tick120 += 1) {
    kernel.step(inputAt(tick120));
  }
  return kernel;
}

function optionsFor(patternId: CanonicalCombatPatternId) {
  return {
    ...OPTIONS,
    patternId,
    projectilePoolClasses: patternId === "room.information.notification_overflow"
      || patternId === "encounter.weather_echo.rain_packets"
      ? Object.freeze({"bullet.micro.dash": "micro" as const})
      : patternId === "encounter.weather_echo.wind_bias"
        ? Object.freeze({"bullet.micro.seed": "micro" as const})
        : patternId === "encounter.weather_echo.ash_memory"
          ? Object.freeze({"bullet.micro.shard": "micro" as const})
        : OPTIONS.projectilePoolClasses,
    roomId: patternId === "boss.misreader.phase1"
      || patternId === "room.in_between.context_switch"
      || patternId === "room.in_between.misregistration_corridor"
      || patternId === "room.in_between.stable_intersection"
      ? "IN_BETWEEN"
      : patternId === "boss.one_sun_one_rule.phase1"
        || patternId === "room.forced.left_right_gate"
        || patternId === "room.forced.unstable_middle"
        || patternId === "room.forced.ballot_shift"
        || patternId === "room.forced.crack_fall_loop"
        ? "FORCED_ALIGNMENT"
      : patternId === "room.polarized.alternating_verdict"
        || patternId === "room.polarized.clock_decree"
        || patternId === "room.polarized.hard_cut_corridor"
        || patternId === "room.polarized.no_dusk_grid"
        ? "POLARIZED"
        : "INFORMATION",
  };
}

function driveWithDeltas(deltas: readonly number[]): CanonicalCombatKernel {
  const kernel = new CanonicalCombatKernel(OPTIONS);
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step(inputAt(tick120)),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(1400);
  return kernel;
}

function driveAlternatingVerdictWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  presentationProfile = "full-motion/default-flash/clear-weather",
): CanonicalCombatKernel {
  expect(presentationProfile.length).toBeGreaterThan(0);
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.polarized.alternating_verdict"),
    seed: ALTERNATING_VERDICT_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step({...inputAt(tick120), focused: false}),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveHardCutWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
): CanonicalCombatKernel {
  const pattern = executablePattern("room.polarized.hard_cut_corridor");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.polarized.hard_cut_corridor"),
    seed: HARD_CUT_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step(safeGapFollowingInput(kernel, pattern, tick120)),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveStalePacketRetryWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
): CanonicalCombatKernel {
  const pattern = executablePattern("room.information.stale_packet_retry");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.information.stale_packet_retry"),
    seed: STALE_PACKET_RETRY_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step(safeGapFollowingInput(kernel, pattern, tick120)),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveAbsentReceiverQueryWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
): CanonicalCombatKernel {
  const pattern = executablePattern("boss.absent_receiver.phase1");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("boss.absent_receiver.phase1"),
    seed: ABSENT_RECEIVER_QUERY_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step(safeGapFollowingInput(kernel, pattern, tick120)),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveNotificationOverflowWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
): CanonicalCombatKernel {
  const pattern = executablePattern("room.information.notification_overflow");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.information.notification_overflow"),
    seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step(safeGapFollowingInput(kernel, pattern, tick120)),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveWindBiasWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  roomId = "INFORMATION",
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("encounter.weather_echo.wind_bias");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("encounter.weather_echo.wind_bias"),
    seed: WIND_BIAS_REPORT_SEED,
    roomId,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step({
      ...safeGapFollowingInput(kernel, pattern, tick120),
      ...presentationProfile,
    } as CanonicalCombatStepInput),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveRainPacketsWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  roomId = "INFORMATION",
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("encounter.weather_echo.rain_packets");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("encounter.weather_echo.rain_packets"),
    seed: RAIN_PACKETS_REPORT_SEED,
    roomId,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step({
      ...safeGapFollowingInput(kernel, pattern, tick120),
      ...presentationProfile,
    } as CanonicalCombatStepInput),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveDuskSettleWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  roomId = "INFORMATION",
): CanonicalCombatKernel {
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("transition.dusk_settle"),
    seed: DUSK_SETTLE_REPORT_SEED,
    roomId,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step({...inputAt(tick120), focused: false}),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveOverrideVoidWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("transition.override_void");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("transition.override_void"),
    seed: OVERRIDE_VOID_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step({
      ...safeGapFollowingInput(kernel, pattern, tick120),
      ...presentationProfile,
    } as CanonicalCombatStepInput),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveCrackFallLoopWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  startTick120 = 0,
  presentationProfile = "full-motion/default-flash/clear-weather",
): CanonicalCombatKernel {
  const pattern = executablePattern("room.forced.crack_fall_loop");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.forced.crack_fall_loop"),
    seed: CRACK_FALL_LOOP_REPORT_SEED,
    startTick120,
  });
  expect(presentationProfile.length).toBeGreaterThan(0);
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 <= startTick120 || tick120 > startTick120 + targetTick120) return;
      const relativeTick120 = tick120 - startTick120;
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveContextSwitchWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  startTick120 = 0,
  presentationProfile = "full-motion/default-flash/clear-weather",
): CanonicalCombatKernel {
  const pattern = executablePattern("room.in_between.context_switch");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.in_between.context_switch"),
    seed: CONTEXT_SWITCH_REPORT_SEED,
    startTick120,
  });
  expect(presentationProfile.length).toBeGreaterThan(0);
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 <= startTick120 || tick120 > startTick120 + targetTick120) return;
      const relativeTick120 = tick120 - startTick120;
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveOneSunOneRuleWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("boss.one_sun_one_rule.phase1");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("boss.one_sun_one_rule.phase1"),
    seed: ONE_SUN_ONE_RULE_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 > targetTick120) return;
      const relativeTick120 = tick120;
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
        ...presentationProfile,
      } as CanonicalCombatStepInput);
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveClockDecreeWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("room.polarized.clock_decree");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.polarized.clock_decree"),
    seed: CLOCK_DECREE_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 > targetTick120) return;
      kernel.step({
        ...safeGapFollowingInput(kernel, pattern, tick120),
        ...presentationProfile,
      } as CanonicalCombatStepInput);
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveNoDuskGridWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("room.polarized.no_dusk_grid");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.polarized.no_dusk_grid"),
    seed: NO_DUSK_GRID_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 > targetTick120) return;
      kernel.step({
        ...safeGapFollowingInput(kernel, pattern, tick120),
        ...presentationProfile,
      } as CanonicalCombatStepInput);
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveRoomThresholdWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  startTick120 = 0,
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("transition.room_threshold");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("transition.room_threshold"),
    seed: ROOM_THRESHOLD_REPORT_SEED,
    startTick120,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 <= startTick120 || tick120 > startTick120 + targetTick120) return;
      const relativeTick120 = tick120 - startTick120;
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
        ...presentationProfile,
      } as CanonicalCombatStepInput);
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveStableIntersectionWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  startTick120 = 0,
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("room.in_between.stable_intersection");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.in_between.stable_intersection"),
    seed: STABLE_INTERSECTION_REPORT_SEED,
    startTick120,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 <= startTick120 || tick120 > startTick120 + targetTick120) return;
      const relativeTick120 = tick120 - startTick120;
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
        ...presentationProfile,
      } as CanonicalCombatStepInput);
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveBallotShiftWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
  startTick120 = 0,
  presentationProfile: Readonly<{
    weatherEvent: string;
    reducedMotion: boolean;
    flashOff: boolean;
  }> = {weatherEvent: "clear", reducedMotion: false, flashOff: false},
): CanonicalCombatKernel {
  const pattern = executablePattern("room.forced.ballot_shift");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("room.forced.ballot_shift"),
    seed: BALLOT_SHIFT_REPORT_SEED,
    startTick120,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 <= startTick120 || tick120 > startTick120 + targetTick120) return;
      const relativeTick120 = tick120 - startTick120;
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
        ...presentationProfile,
      } as CanonicalCombatStepInput);
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(kernel.snapshot().relativeTick120).toBe(targetTick120);
  return kernel;
}

function driveUnstableMiddleWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
): CanonicalCombatKernel {
  const kernel = new CanonicalCombatKernel(optionsFor("room.forced.unstable_middle"));
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step({...inputAt(tick120), focused: false}),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveLeftRightGateWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
): CanonicalCombatKernel {
  const kernel = new CanonicalCombatKernel(optionsFor("room.forced.left_right_gate"));
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step({...inputAt(tick120), focused: false}),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

function driveUnansweringFeedWithDeltas(
  deltas: readonly number[],
  targetTick120: number,
): CanonicalCombatKernel {
  const pattern = executablePattern("boss.unanswering_feed.phase1");
  const kernel = new CanonicalCombatKernel({
    ...optionsFor("boss.unanswering_feed.phase1"),
    seed: UNANSWERING_FEED_REPORT_SEED,
  });
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => kernel.step(safeGapFollowingInput(kernel, pattern, tick120)),
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(targetTick120);
  return kernel;
}

describe("canonical combat kernel capability families", () => {
  it("uses crossed-time tick identity without rounding authored boundaries early", () => {
    expect(crossedTickCount(0)).toBe(0);
    expect(crossedTickCount(40)).toBe(5);
    expect(crossedTickCount(601)).toBe(73);
    expect(crossedTickCount(8600)).toBe(1032);

    const kernel = runTo(77);
    expect(kernel.events().find((event) => event.id === "projectile.spawn.commit")?.tick120).toBe(73);
    expect(kernel.events().find((event) => event.id === "projectile.armed")?.tick120).toBe(77);
    const activationEvents = kernel.events().filter((event) => event.tick120 === 77);
    expect(activationEvents.some((event) =>
      event.id === "projectile.impact.commit" || event.id === "projectile.cancel.commit")).toBe(false);
  });

  it("fails closed outside the implemented V4 pattern and explicit adapter gaps", () => {
    expect(() => new CanonicalCombatKernel({...OPTIONS, patternId: "room.information.missing_ack"}))
      .toThrow(/does not yet support pattern/);
    expect(() => new CanonicalCombatKernel({
      ...OPTIONS,
      patternId: "boss.two_claims.phase2",
      roomId: "FORCED_ALIGNMENT",
      projectilePoolClasses: {"bullet.micro.seed": "micro"},
    })).toThrow(/does not yet support pattern/);
    expect(() => new CanonicalCombatKernel({...OPTIONS, grazeRadiusPx: 0})).toThrow(/grazeRadiusPx/);
    expect(() => new CanonicalCombatKernel({...OPTIONS, projectileDamage: 0})).toThrow(/projectileDamage/);
    expect(() => new CanonicalCombatKernel({...OPTIONS, projectilePoolClasses: {}}))
      .toThrow(/pool-class mapping/);
    expect(() => new CanonicalCombatKernel({
      ...OPTIONS,
      projectilePoolClasses: {
        "bullet.micro.notch_e": "micro",
        "bullet.unowned": "heavy",
      },
    })).toThrow(/exact projectile pool-class mapping|not a canonical V4 projectile archetype/);
    expect(() => new CanonicalCombatKernel({...OPTIONS, roomId: "COMMON"})).toThrow(/not authored/);
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("room.information.unanswered_fan"),
      roomId: "POLARIZED",
    })).toThrow(/room mismatch/);
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("boss.misreader.phase1"),
      roomId: "INFORMATION",
    })).toThrow(/room mismatch/);
    let difficultyReads = 0;
    const accessorDifficulty = {
      ...OPTIONS,
      get difficulty(): "NORMAL" {
        difficultyReads += 1;
        return "NORMAL";
      },
    };
    expect(() => new CanonicalCombatKernel(accessorDifficulty))
      .toThrow(/options\.difficulty must be an own data property/);
    expect(difficultyReads).toBe(0);
    let poolReads = 0;
    const accessorPool = Object.defineProperty({}, "bullet.micro.notch_e", {
      enumerable: true,
      get: () => {
        poolReads += 1;
        return "micro";
      },
    });
    expect(() => new CanonicalCombatKernel({
      ...OPTIONS,
      projectilePoolClasses: accessorPool as Record<string, "micro">,
    })).toThrow(/projectilePoolClasses.*own data property/);
    expect(poolReads).toBe(0);
  });

  it("admits only the Boss rig observe phase whose active laser is explicitly absent", () => {
    expect(() => validateBossObservePhaseContract({
      id: "observe",
      patternId: "boss.misreader.phase1",
      laserGeometry: null,
    }, "boss.misreader.phase1")).not.toThrow();
    expect(() => validateBossObservePhaseContract({
      id: "observe",
      patternId: "boss.unanswering_feed.phase1",
      laserGeometry: null,
    }, "boss.unanswering_feed.phase1")).not.toThrow();
    expect(() => validateBossObservePhaseContract({
      id: "observe",
      patternId: "boss.absent_receiver.phase1",
      laserGeometry: null,
    }, "boss.absent_receiver.phase1")).not.toThrow();
    const absentReceiverObserve = {
      id: "observe",
      patternId: "boss.absent_receiver.phase1",
      entryCondition: "encounter.begin",
      exitCondition: "absent_receiver.evidence>=1",
      laserGeometry: null,
      spatialLaw: "unreturned_packets",
    } as const;
    expect(() => validateAbsentReceiverObserveRigContract(absentReceiverObserve)).not.toThrow();
    expect(() => validateAbsentReceiverObserveRigContract({
      ...absentReceiverObserve,
      exitCondition: "absent_receiver.phaseEvidence>=1",
    })).toThrow(/rig contract drifted/);
    let spatialLawReads = 0;
    const accessorAbsentReceiverObserve = Object.defineProperty(
      {...absentReceiverObserve},
      "spatialLaw",
      {
        enumerable: true,
        get() {
          spatialLawReads += 1;
          return "unreturned_packets";
        },
      },
    );
    expect(() => validateAbsentReceiverObserveRigContract(accessorAbsentReceiverObserve))
      .toThrow(/own data property/);
    expect(spatialLawReads).toBe(0);
    expect(() => validateBossObservePhaseContract({
      id: "enforce",
      patternId: "boss.misreader.phase2",
      laserGeometry: "laser.misread_bezier",
    }, "boss.misreader.phase2")).toThrow(/not the rig observe phase/);
    expect(() => validateBossObservePhaseContract({
      id: "observe",
      patternId: "boss.misreader.phase1",
      laserGeometry: "laser.misread_bezier",
    }, "boss.misreader.phase1")).toThrow(/active laser authority/);
    expect(() => validateBossObservePhaseContract({
      id: "enforce",
      patternId: "boss.unanswering_feed.phase2",
      laserGeometry: "laser.scrolling_comb",
    }, "boss.unanswering_feed.phase2")).toThrow(/not the rig observe phase/);

    let laserReads = 0;
    const accessorPhase = Object.defineProperty({
      id: "observe",
      patternId: "boss.misreader.phase1",
    }, "laserGeometry", {
      enumerable: true,
      get() {
        laserReads += 1;
        return null;
      },
    });
    expect(() => validateBossObservePhaseContract(accessorPhase, "boss.misreader.phase1"))
      .toThrow(/own data property/);
    expect(laserReads).toBe(0);

    const kernel = new CanonicalCombatKernel(optionsFor("boss.misreader.phase1"));
    expect(kernel.patternContractSnapshot()).toMatchObject({
      id: "boss.misreader.phase1",
      laserGeometry: "laser.misread_bezier",
    });
    const unansweringFeed = new CanonicalCombatKernel(
      optionsFor("boss.unanswering_feed.phase1"),
    );
    expect(unansweringFeed.patternContractSnapshot()).toMatchObject({
      id: "boss.unanswering_feed.phase1",
      laserGeometry: "laser.scrolling_comb",
    });
    const absentReceiver = new CanonicalCombatKernel(
      optionsFor("boss.absent_receiver.phase1"),
    );
    expect(absentReceiver.patternContractSnapshot()).toMatchObject({
      id: "boss.absent_receiver.phase1",
      laserGeometry: "laser.broken_packet_polyline",
      resolutionHook: {
        type: "phase_evidence",
        canonicalBossId: "boss.absent_receiver",
        condition: "absent_receiver.phaseEvidence>=1",
        terminalEvent: null,
      },
    });
    expect(absentReceiver.events()).toEqual([]);
  });

  it("executes only the declared production capability set from immutable manifests", () => {
    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS).not.toContain("boss.two_claims.phase2");
    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS).toEqual([
      "common.eye_acquisition",
      "common.graze_calibration",
      "encounter.weather_echo.rain_packets",
      "encounter.weather_echo.wind_bias",
      "room.in_between.context_switch",
      "room.in_between.misregistration_corridor",
      "transition.dusk_settle",
      "transition.override_void",
      "room.forced.ballot_shift",
      "room.forced.crack_fall_loop",
      "room.forced.left_right_gate",
      "room.forced.unstable_middle",
      "room.information.unanswered_fan",
      "room.information.stale_packet_retry",
      "room.information.notification_overflow",
      "room.polarized.alternating_verdict",
      "room.polarized.hard_cut_corridor",
      "boss.absent_receiver.phase1",
      "boss.misreader.phase1",
      "boss.one_sun_one_rule.phase1",
      "boss.unanswering_feed.phase1",
    ]);
    for (const patternId of SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS) {
      const first = new CanonicalCombatKernel(optionsFor(patternId));
      const second = new CanonicalCombatKernel(optionsFor(patternId));
      for (let tick120 = 1; tick120 <= 360; tick120 += 1) {
        const sample = inputAt(tick120);
        first.step(sample);
        second.step(sample);
      }
      expect(first.snapshot().patternId).toBe(patternId);
      expect(first.patternContractSnapshot().id).toBe(patternId);
      expect(first.events().some((event) => event.id === "projectile.spawn.commit")).toBe(true);
      expect(first.canonicalEventSerialization()).toBe(second.canonicalEventSerialization());
      expect(first.snapshot()).toEqual(second.snapshot());
    }
    expect(new CanonicalCombatKernel(OPTIONS).snapshot().patternId).toBe("common.eye_acquisition");
  });

  it("pins the immutable left/right wall contract and separates Python QA from declared semantics", () => {
    const kernel = new CanonicalCombatKernel(optionsFor("room.forced.left_right_gate"));
    const contract = kernel.patternContractSnapshot();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.emitters)).toBe(true);
    expect(contract).toMatchObject({
      id: "room.forced.left_right_gate",
      room: "FORCED_ALIGNMENT",
      durationMs: 10200,
      warning: {
        durationMs: 729,
        shape: "alternating_half_planes",
        coversSweptArea: true,
        collisionEnabled: false,
      },
      safeGap: {
        type: "seam_corridor",
        minimumWidthPx: 30,
        enforcement: "lane_omission",
        path: {centerX: 180, amplitudePx: 10, periodMs: 3600, maxTravelPxPerSec: 78},
      },
      residue: {type: "seam_filament", lifetimeMs: 2631, gameplayCollision: false},
    });
    expect(contract.emitters.map((emitter) => ({
      id: emitter.id,
      anchor: emitter.anchor,
      geometry: emitter.geometry,
      cadence: emitter.cadence,
      projectile: emitter.projectile,
      speed: emitter.speedCurve.keys,
      motion: emitter.motionStack,
    }))).toEqual([
      {
        id: "left-wall",
        anchor: {space: "viewport-normalized", x: 0.24, y: 0.04},
        geometry: {
          type: "wall",
          variant: "left-claim",
          count: 8,
          baseAngleDeg: 90,
          spreadDeg: 0,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 729, intervalMs: 920, bursts: 10, intraBurstMs: 0},
        projectile: {
          archetype: "bullet.micro.notch_e",
          collisionRadiusPx: 2,
          armDelayMs: 40,
        },
        speed: [{atMs: 0, pxPerSec: 148}],
        motion: [
          {operator: "op.lateral_wall", params: {laneCount: 12, openLane: 5, driftPxPerSec: 18}},
          {operator: "op.linear", params: {}},
        ],
      },
      {
        id: "right-wall",
        anchor: {space: "viewport-normalized", x: 0.76, y: 0.04},
        geometry: {
          type: "wall",
          variant: "right-claim",
          count: 8,
          baseAngleDeg: 90,
          spreadDeg: 0,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 1189, intervalMs: 920, bursts: 10, intraBurstMs: 0},
        projectile: {
          archetype: "bullet.micro.notch_e",
          collisionRadiusPx: 2,
          armDelayMs: 40,
        },
        speed: [{atMs: 0, pxPerSec: 148}],
        motion: [
          {operator: "op.lateral_wall", params: {laneCount: 12, openLane: 6, driftPxPerSec: -18}},
          {operator: "op.linear", params: {}},
        ],
      },
    ]);

    expect(geometryCandidates(contract.emitters[0]!, 0, 8).slice(0, 2)).toEqual([
      {x: 36.5, y: 25.6, headingDeg: 90, sourceIndex: 0},
      {x: 77.5, y: 25.6, headingDeg: 90, sourceIndex: 1},
    ]);
    expect(geometryCandidates(contract.emitters[0]!, 1, 8).slice(0, 2)).toEqual([
      {x: 56.75, y: 25.6, headingDeg: 90, sourceIndex: 0},
      {x: 97.75, y: 25.6, headingDeg: 90, sourceIndex: 1},
    ]);

    const pythonQaOnly = simulatePattern("room.forced.left_right_gate", {
      seed: 1782737050,
      semantics: "reference-v4",
    });
    expect({
      traceSha256: pythonQaOnly.traceSha256,
      emissions: pythonQaOnly.events.length,
      gapInterventions: pythonQaOnly.omittedOrRedirected,
      splitChildren: pythonQaOnly.splitChildren,
    }).toEqual({
      traceSha256: "92611a6032c31d2d6366b6f87fe828d96790bbd22071744969676e44cacfbd5f",
      emissions: 20,
      gapInterventions: 14,
      splitChildren: 0,
    });

    // The immutable Python oracle predates lateral-wall execution. This second
    // checksum is the application regression source for the declared V4 operator.
    const declaredV4 = simulatePattern("room.forced.left_right_gate", {
      seed: 1782737050,
      semantics: "declared-v4",
    });
    expect({
      traceSha256: declaredV4.traceSha256,
      emissions: declaredV4.events.length,
      gapInterventions: declaredV4.omittedOrRedirected,
      splitChildren: declaredV4.splitChildren,
    }).toEqual({
      traceSha256: "593d497ab179dee706b2d71ab58a5d515673526ec541ff0c589941779e38b202",
      emissions: 20,
      gapInterventions: 14,
      splitChildren: 0,
    });
    expect(declaredV4.traceSha256).not.toBe(pythonQaOnly.traceSha256);
  });

  it("fails closed on wall and lateral-lane contract drift without invoking accessors", () => {
    const validWall = {
      type: "wall",
      variant: "left-claim",
      count: 8,
      baseAngleDeg: 90,
      spreadDeg: 0,
      ordering: "clockwise-then-source-index",
    } as const;
    expect(() => validateWallGeometryContract(validWall)).not.toThrow();
    expect(() => validateWallGeometryContract(Object.assign(Object.create(null), validWall)))
      .not.toThrow();
    for (const invalid of [
      {...validWall, type: "fan"},
      {...validWall, ordering: "source-index-then-clockwise"},
      {...validWall, variant: ""},
      {...validWall, count: 0},
      {...validWall, count: 1.5},
      {...validWall, baseAngleDeg: -1},
      {...validWall, spreadDeg: Number.POSITIVE_INFINITY},
      {...validWall, extraRule: "unowned"},
      {
        type: "wall",
        variant: "left-claim",
        count: 8,
        baseAngleDeg: 90,
        spreadDeg: 0,
      },
      Object.assign(Object.create({inherited: true}), validWall),
      {...validWall, [Symbol("unowned")]: true},
    ]) {
      expect(() => validateWallGeometryContract(invalid)).toThrow();
    }

    let wallReads = 0;
    const accessorWall = Object.defineProperty(
      {
        type: "wall",
        variant: "left-claim",
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      "count",
      {
        enumerable: true,
        get() {
          wallReads += 1;
          return 8;
        },
      },
    );
    expect(() => validateWallGeometryContract(accessorWall)).toThrow(/own data property/);
    expect(wallReads).toBe(0);

    const validLeft = {laneCount: 12, openLane: 5, driftPxPerSec: 18} as const;
    const validRight = {laneCount: 12, openLane: 6, driftPxPerSec: -18} as const;
    expect(() => validateLateralWallParameters(validLeft)).not.toThrow();
    expect(() => validateLateralWallParameters(validRight)).not.toThrow();
    expect(() => validateLateralWallParameters(Object.assign(Object.create(null), validLeft)))
      .not.toThrow();
    for (const invalid of [
      {...validLeft, laneCount: 0},
      {...validLeft, laneCount: 1.5},
      {...validLeft, openLane: -1},
      {...validLeft, openLane: 1.5},
      {...validLeft, openLane: 12},
      {...validLeft, openLane: 13},
      {...validLeft, driftPxPerSec: Number.POSITIVE_INFINITY},
      {...validLeft, extraRule: "unowned"},
      {laneCount: 12, openLane: 5},
      Object.assign(Object.create({inherited: true}), validLeft),
      {...validLeft, [Symbol("unowned")]: true},
    ]) {
      expect(() => validateLateralWallParameters(invalid)).toThrow();
    }

    let lateralReads = 0;
    const accessorLateral = Object.defineProperty(
      {laneCount: 12, openLane: 5},
      "driftPxPerSec",
      {
        enumerable: true,
        get() {
          lateralReads += 1;
          return 18;
        },
      },
    );
    expect(() => validateLateralWallParameters(accessorLateral)).toThrow(/own data property/);
    expect(lateralReads).toBe(0);
  });

  it("omits declared scaled lanes before spawn and applies signed drift after arming", () => {
    const pattern = executablePattern("room.forced.left_right_gate");
    const schedule = createPatternSchedule(pattern, "NORMAL");
    expect(schedule).toHaveLength(20);
    expect(schedule.slice(0, 4).map((entry) => ({
      source: entry.emitter.id,
      burst: entry.burstIndex,
      atMs: entry.atMs,
      tick120: crossedTickCount(entry.atMs),
    }))).toEqual([
      {source: "left-wall", burst: 0, atMs: 729, tick120: 88},
      {source: "right-wall", burst: 0, atMs: 1189, tick120: 143},
      {source: "left-wall", burst: 1, atMs: 1649, tick120: 198},
      {source: "right-wall", burst: 1, atMs: 2109, tick120: 254},
    ]);

    const kernel = new CanonicalCombatKernel(optionsFor("room.forced.left_right_gate"));
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    const first = (sourceId: string) => {
      const projectile = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === sourceId && entry.burstIndex === 0 && entry.sourceIndex === 0);
      expect(projectile, sourceId).toBeDefined();
      return projectile as NonNullable<typeof projectile>;
    };

    stepTo(88);
    expect(kernel.snapshot().projectiles
      .filter((entry) => entry.sourceId === "left-wall" && entry.burstIndex === 0)
      .map((entry) => entry.sourceIndex)).toEqual([0, 1, 4, 5, 6, 7]);
    expect(kernel.snapshot().rngCallsConsumed).toBe(7);
    expect(first("left-wall")).toMatchObject({
      position: {x: 36.5, y: 25.6},
      previousPosition: {x: 36.5, y: 25.6},
      state: "arm",
      spawnedAtTick: 88,
      armAtTick: 93,
    });
    stepTo(93);
    const leftBeforeMotion = first("left-wall");
    stepTo(94);
    const leftAfterMotion = first("left-wall");
    expect(leftAfterMotion.position.x - leftBeforeMotion.position.x).toBeCloseTo(18 / 120, 12);
    expect(leftAfterMotion.position.y - leftBeforeMotion.position.y).toBeCloseTo(148 / 120, 12);

    stepTo(143);
    expect(kernel.snapshot().projectiles
      .filter((entry) => entry.sourceId === "right-wall" && entry.burstIndex === 0)
      .map((entry) => entry.sourceIndex)).toEqual([0, 1, 2, 3, 6, 7]);
    // Both 8-candidate walls omit one declared lane before RNG. Safe-gap
    // preflight then rejects one candidate per wall after consuming jitter,
    // leaving 12 entities from 14 random calls.
    expect(kernel.snapshot().rngCallsConsumed).toBe(14);
    expect(kernel.events().filter((event) => event.id === "projectile.spawn.commit")).toHaveLength(12);
    expect(first("right-wall")).toMatchObject({
      position: {x: 36.5, y: 25.6},
      previousPosition: {x: 36.5, y: 25.6},
      state: "arm",
      spawnedAtTick: 143,
      armAtTick: 148,
    });
    stepTo(148);
    const rightBeforeMotion = first("right-wall");
    stepTo(149);
    const rightAfterMotion = first("right-wall");
    expect(rightAfterMotion.position.x - rightBeforeMotion.position.x).toBeCloseTo(-18 / 120, 12);
    expect(rightAfterMotion.position.y - rightBeforeMotion.position.y).toBeCloseTo(148 / 120, 12);

    const firstSpawnTicks = [...new Set(kernel.events()
      .filter((event) => event.id === "projectile.spawn.commit")
      .map((event) => event.tick120))];
    expect(firstSpawnTicks).toEqual([88, 143]);
  });

  it("keeps every scaled left/right wall outside the seam without runtime withdrawal", () => {
    const expected = {
      EASY: {totalCandidates: 108, laneOmissions: 9, gapOmissions: 13, spawnCommits: 86},
      NORMAL: {totalCandidates: 160, laneOmissions: 20, gapOmissions: 16, spawnCommits: 124},
      HARD: {totalCandidates: 180, laneOmissions: 10, gapOmissions: 22, spawnCommits: 148},
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.forced.left_right_gate"),
        difficulty,
      });
      const pattern = kernel.patternContractSnapshot();
      const schedule = createPatternSchedule(pattern, difficulty);
      let totalCandidates = 0;
      let laneOmissions = 0;
      for (const scheduled of schedule) {
        const count = roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        );
        totalCandidates += count;
        const lateral = scheduled.emitter.motionStack.find((entry) =>
          entry.operator === "op.lateral_wall");
        expect(lateral).toBeDefined();
        const laneCount = lateral?.params.laneCount as number;
        const openLane = lateral?.params.openLane as number;
        for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
          const lane = Math.min(
            laneCount - 1,
            Math.floor((sourceIndex + 0.5) * laneCount / count),
          );
          if (lane === openLane) laneOmissions += 1;
        }
      }

      const observedSources = new Set<string>();
      for (let tick120 = 1; tick120 < crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step({...inputAt(tick120), focused: false});
        const relativeMs = snapshot.relativeTick120 * 1000 / 120;
        const corridorCenter = safeGapCenter(pattern, relativeMs);
        for (const projectile of snapshot.projectiles) {
          observedSources.add(projectile.sourceId);
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }
      const spawnCommits = kernel.events().filter((event) =>
        event.id === "projectile.spawn.commit").length;
      expect({
        totalCandidates,
        laneOmissions,
        gapOmissions: totalCandidates - laneOmissions - spawnCommits,
        spawnCommits,
      }).toEqual(expected[difficulty]);
      expect([...observedSources].sort()).toEqual(["left-wall", "right-wall"]);
      expect(kernel.events().filter((event) =>
        event.id === "projectile.cancel.commit"
        && event.payload.reason === "source_withdrawn")).toEqual([]);
      expect(kernel.snapshot().lastDamageBatch).toBeNull();
      if (difficulty === "NORMAL") {
        expect([...new Set(kernel.events()
          .filter((event) => event.id === "projectile.spawn.commit")
          .map((event) => event.tick120))]).toEqual([
          88, 143, 198, 254, 309, 364, 419, 474, 530, 585,
          640, 695, 750, 806, 861, 916, 971, 1026, 1082, 1137,
        ]);
      }
    }
  });

  it("is render-cadence invariant for the left/right wall capability", () => {
    const targetTick120 = 400;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveLeftRightGateWithDeltas(
      Array.from({length: 100}, () => 1000 / 30),
      targetTick120,
    );
    const at144Hz = driveLeftRightGateWithDeltas(
      Array.from({length: 480}, () => 1000 / 144),
      targetTick120,
    );
    const retainedBacklog = driveLeftRightGateWithDeltas([durationMs], targetTick120);
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(retainedBacklog.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(retainedBacklog.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("resolves a drifting-wall swept hit with collision-off before impact and damage", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.left_right_gate"),
      difficulty: "HARD",
      initialPlayerPosition: {x: 90, y: 570},
    });
    for (let tick120 = 1; tick120 <= 485; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    expect(kernel.snapshot().lastDamageBatch).toMatchObject({
      tick120: 485,
      committedSourceId: "combat:room.forced.left_right_gate/micro/0000:0",
      branch: "non-fatal",
    });
    const events = kernel.events().filter((event) => event.tick120 === 485);
    const collisionOff = events.findIndex((event) => event.id === "projectile.collision.off");
    const impact = events.findIndex((event) => event.id === "projectile.impact.commit");
    const damage = events.findIndex((event) => event.id === "player.damage.commit");
    expect(collisionOff).toBeGreaterThanOrEqual(0);
    expect(impact).toBeGreaterThan(collisionOff);
    expect(damage).toBeGreaterThan(impact);
    expect(events[collisionOff]?.phasePriority).toBe(0);
    expect(events[impact]?.phasePriority).toBe(1);
    expect(events[damage]?.phasePriority).toBe(1);
    expect(kernel.snapshot().projectiles.find((entry) =>
      entry.instanceId === "combat:room.forced.left_right_gate/micro/0000")).toMatchObject({
      sourceId: "left-wall",
      sourceIndex: 0,
      burstIndex: 0,
      headingDegrees: 90,
      speedPxPerSecond: 165.76000000000002,
      state: "residue",
      collisionEnabled: false,
    });
  });

  it("cancels the left/right walls at pattern end and drains at the residue boundary", () => {
    const kernel = new CanonicalCombatKernel(optionsFor("room.forced.left_right_gate"));
    for (let tick120 = 1; tick120 <= 1224; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1224,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles.length).toBeGreaterThan(0);
    expect(kernel.snapshot().projectiles.every((projectile) => projectile.state === "residue"))
      .toBe(true);
    expect(kernel.events().some((event) =>
      event.tick120 === 1224
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toBe(true);

    for (let tick120 = 1225; tick120 <= 1539; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1539,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    kernel.step({...inputAt(1540), focused: false});
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1540,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
  });

  it("pins the immutable unanswering-feed rule clip and its dual oracle provenance", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.unanswering_feed.phase1"),
      seed: UNANSWERING_FEED_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.emitters)).toBe(true);
    expect(contract).toMatchObject({
      id: "boss.unanswering_feed.phase1",
      category: "BOSS",
      room: "INFORMATION",
      durationMs: 12900,
      warning: {
        durationMs: 670,
        shape: "feed-columns_swept_union",
        coversSweptArea: true,
        collisionEnabled: false,
      },
      safeGap: {
        type: "moving_window",
        minimumWidthPx: 39,
        enforcement: "rule_clip_with_residue",
        path: {centerX: 180, amplitudePx: 48, periodMs: 7600, maxTravelPxPerSec: 78},
      },
      residue: {
        type: "unanswering_feed_material_trace",
        lifetimeMs: 2559,
        gameplayCollision: false,
      },
      laserGeometry: "laser.scrolling_comb",
      resolutionHook: {
        type: "phase_evidence",
        canonicalBossId: "boss.unanswering_feed",
        resolutionId: "QUEUE_EXHAUSTED",
        terminalEvent: null,
      },
    });
    expect(contract.emitters.map((emitter) => ({
      id: emitter.id,
      anchor: emitter.anchor,
      geometry: emitter.geometry,
      cadence: emitter.cadence,
      projectile: emitter.projectile,
      speed: emitter.speedCurve.keys,
      motion: emitter.motionStack,
    }))).toEqual([
      {
        id: "unanswering_feed-p1-primary",
        anchor: {space: "viewport-normalized", x: 0.34, y: 0.1},
        geometry: {
          type: "wall",
          variant: "feed-columns",
          count: 10,
          baseAngleDeg: 82,
          spreadDeg: 123,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 670, intervalMs: 939, bursts: 12, intraBurstMs: 0},
        projectile: {
          archetype: "bullet.micro.notch_e",
          collisionRadiusPx: 2,
          armDelayMs: 40,
        },
        speed: [{atMs: 0, pxPerSec: 166}],
        motion: [
          {operator: "op.lateral_wall", params: {laneCount: 13, openLane: 6, driftPxPerSec: 9}},
          {operator: "op.linear", params: {}},
        ],
      },
      {
        id: "unanswering_feed-p1-counter",
        anchor: {space: "viewport-normalized", x: 0.66, y: 0.18},
        geometry: {
          type: "arc",
          variant: "counter-feed-columns",
          count: 5,
          baseAngleDeg: 100,
          spreadDeg: 102,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 1139, intervalMs: 1878, bursts: 5, intraBurstMs: 0},
        projectile: {
          archetype: "bullet.micro.notch_e",
          collisionRadiusPx: 2,
          armDelayMs: 40,
        },
        speed: [{atMs: 0, pxPerSec: 126}],
        motion: [{operator: "op.linear", params: {}}],
      },
    ]);

    const normalSchedule = createPatternSchedule(contract, "NORMAL");
    expect(normalSchedule.map((entry) => ({
      source: entry.emitter.id,
      burst: entry.burstIndex,
      tick120: crossedTickCount(entry.atMs),
    }))).toEqual([
      {source: "unanswering_feed-p1-primary", burst: 0, tick120: 81},
      {source: "unanswering_feed-p1-counter", burst: 0, tick120: 137},
      {source: "unanswering_feed-p1-primary", burst: 1, tick120: 194},
      {source: "unanswering_feed-p1-primary", burst: 2, tick120: 306},
      {source: "unanswering_feed-p1-counter", burst: 1, tick120: 363},
      {source: "unanswering_feed-p1-primary", burst: 3, tick120: 419},
      {source: "unanswering_feed-p1-primary", burst: 4, tick120: 532},
      {source: "unanswering_feed-p1-counter", burst: 2, tick120: 588},
      {source: "unanswering_feed-p1-primary", burst: 5, tick120: 644},
      {source: "unanswering_feed-p1-primary", burst: 6, tick120: 757},
      {source: "unanswering_feed-p1-counter", burst: 3, tick120: 813},
      {source: "unanswering_feed-p1-primary", burst: 7, tick120: 870},
      {source: "unanswering_feed-p1-primary", burst: 8, tick120: 982},
      {source: "unanswering_feed-p1-counter", burst: 4, tick120: 1039},
      {source: "unanswering_feed-p1-primary", burst: 9, tick120: 1095},
      {source: "unanswering_feed-p1-primary", burst: 10, tick120: 1208},
      {source: "unanswering_feed-p1-primary", burst: 11, tick120: 1320},
    ]);

    const expected = {
      EASY: {
        candidates: 116,
        referenceHash: "a0bfa88bc44e2944fe0a304c938f738986ad8f5b219e55894b309130133f015a",
        referenceInterventions: 7,
        declaredHash: "685efa19b48d297f5ef2dca62068f8c764b550cddf9a5160c76d2b246576b99c",
        declaredInterventions: 8,
      },
      NORMAL: {
        candidates: 145,
        referenceHash: "a2a51c2f9b2774414427bd3607350859240b8a342b324775957ce88ecb10aa8c",
        referenceInterventions: 15,
        declaredHash: "28fd0ba8bbbf2668a48d0565a7864e66d87c68767ca19de9c6f7dd7334889211",
        declaredInterventions: 15,
      },
      HARD: {
        candidates: 174,
        referenceHash: "b0c3e6552753f589f3fb4f29726c7ba2e83b91f61030a60f22104b4d69c155d8",
        referenceInterventions: 15,
        declaredHash: "ce3a73c0f757c562387364472764888f043505eca67029023959820861922632",
        declaredInterventions: 14,
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: UNANSWERING_FEED_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: UNANSWERING_FEED_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect({
        hash: reference.traceSha256,
        emissions: reference.events.length,
        candidates: reference.events.reduce((total, event) => total + event.count, 0),
        interventions: reference.omittedOrRedirected,
        splitChildren: reference.splitChildren,
      }).toEqual({
        hash: expected[difficulty].referenceHash,
        emissions: 17,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].referenceInterventions,
        splitChildren: 0,
      });
      expect({
        hash: declared.traceSha256,
        emissions: declared.events.length,
        candidates: declared.events.reduce((total, event) => total + event.count, 0),
        interventions: declared.omittedOrRedirected,
        splitChildren: declared.splitChildren,
      }).toEqual({
        hash: expected[difficulty].declaredHash,
        emissions: 17,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].declaredInterventions,
        splitChildren: 0,
      });
      // The immutable Python oracle does not execute `op.lateral_wall`.
      expect(declared.traceSha256).not.toBe(reference.traceSha256);
    }
  });

  it("spawns the central opening without preflight erasure and arms on exact crossed ticks", () => {
    const pattern = executablePattern("boss.unanswering_feed.phase1");
    const primary = pattern.emitters[0]!;
    const normalCount = roundPatternCount(
      primary.geometry.count * pattern.difficulty.NORMAL.countMultiplier,
    );
    const lateral = primary.motionStack.find((entry) => entry.operator === "op.lateral_wall")!;
    const lanes = geometryCandidates(primary, 0, normalCount).map((candidate) => Math.min(
      (lateral.params.laneCount as number) - 1,
      Math.floor(
        (candidate.sourceIndex + 0.5) * (lateral.params.laneCount as number) / normalCount,
      ),
    ));
    expect(lanes).toEqual([0, 1, 3, 4, 5, 7, 8, 9, 11, 12]);
    expect(lanes).not.toContain(6);

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.unanswering_feed.phase1"),
      seed: UNANSWERING_FEED_REPORT_SEED,
    });
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
    };
    const primaryFirst = () => kernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceId === "unanswering_feed-p1-primary"
      && projectile.burstIndex === 0
      && projectile.sourceIndex === 0)!;

    stepTo(81);
    expect(kernel.snapshot().rngCallsConsumed).toBe(10);
    expect(kernel.events().filter((event) => event.id === "projectile.spawn.commit"))
      .toHaveLength(10);
    expect(kernel.snapshot().projectiles
      .filter((projectile) =>
        projectile.sourceId === "unanswering_feed-p1-primary" && projectile.burstIndex === 0)
      .map((projectile) => projectile.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(primaryFirst()).toMatchObject({
      state: "arm",
      spawnedAtTick: 81,
      armAtTick: 86,
      position: {x: 32.400000000000006, y: 64},
    });

    stepTo(86);
    const beforeMotion = primaryFirst();
    expect(beforeMotion.state).toBe("flight");
    stepTo(87);
    const afterMotion = primaryFirst();
    expect(afterMotion.position.x - beforeMotion.position.x).toBeCloseTo(
      (Math.cos(afterMotion.headingDegrees * Math.PI / 180) * 166 + 9) / 120,
      12,
    );
    expect(afterMotion.position.y - beforeMotion.position.y).toBeCloseTo(
      Math.sin(afterMotion.headingDegrees * Math.PI / 180) * 166 / 120,
      12,
    );

    stepTo(137);
    expect(kernel.snapshot().rngCallsConsumed).toBe(15);
    expect(kernel.events().filter((event) => event.id === "projectile.spawn.commit"))
      .toHaveLength(15);
    expect(kernel.snapshot().projectiles
      .filter((projectile) =>
        projectile.sourceId === "unanswering_feed-p1-counter" && projectile.burstIndex === 0)
      .map((projectile) => projectile.sourceIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(kernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceId === "unanswering_feed-p1-counter"
      && projectile.burstIndex === 0
      && projectile.sourceIndex === 0)).toMatchObject({
      state: "arm",
      spawnedAtTick: 137,
      armAtTick: 142,
    });
  });

  it("clips the moving corridor visibly across EASY, NORMAL, and HARD", {
    timeout: 15_000,
  }, () => {
    const pattern = executablePattern("boss.unanswering_feed.phase1");
    const expected = {
      EASY: {
        candidates: 116,
        ruleClips: 8,
        primaryClips: 8,
        counterClips: 0,
        outOfBounds: 69,
        patternEnd: 39,
        firstClipTick: 425,
        lastClipTick: 1488,
      },
      NORMAL: {
        candidates: 145,
        ruleClips: 15,
        primaryClips: 11,
        counterClips: 4,
        outOfBounds: 106,
        patternEnd: 24,
        firstClipTick: 384,
        lastClipTick: 1517,
      },
      HARD: {
        candidates: 174,
        ruleClips: 15,
        primaryClips: 13,
        counterClips: 2,
        outOfBounds: 150,
        patternEnd: 9,
        firstClipTick: 353,
        lastClipTick: 1459,
      },
    } as const;

    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("boss.unanswering_feed.phase1"),
        seed: UNANSWERING_FEED_REPORT_SEED,
        difficulty,
      });
      const schedule = createPatternSchedule(pattern, difficulty);
      let totalCandidates = 0;
      let laneOmissions = 0;
      for (const scheduled of schedule) {
        const count = roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        );
        totalCandidates += count;
        const wall = scheduled.emitter.motionStack.find((entry) =>
          entry.operator === "op.lateral_wall");
        if (wall === undefined) continue;
        const laneCount = wall.params.laneCount as number;
        const openLane = wall.params.openLane as number;
        for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
          const lane = Math.min(
            laneCount - 1,
            Math.floor((sourceIndex + 0.5) * laneCount / count),
          );
          if (lane === openLane) laneOmissions += 1;
        }
      }

      const observedSources = new Set<string>();
      const sourceByHandle = new Map<string, string>();
      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, snapshot.relativeTick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          observedSources.add(projectile.sourceId);
          sourceByHandle.set(
            `${projectile.instanceId}:${projectile.generation}`,
            projectile.sourceId,
          );
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }

      const events = kernel.events();
      const ruleClips = events.filter((event) =>
        event.id === "projectile.cancel.commit"
        && event.payload.reason === "source_withdrawn");
      const sourceFor = (event: (typeof ruleClips)[number]): string | undefined =>
        sourceByHandle.get(`${String(event.payload.instanceId)}:${String(event.payload.generation)}`);
      expect({
        totalCandidates,
        laneOmissions,
        rngCalls: kernel.snapshot().rngCallsConsumed,
        spawnCommits: events.filter((event) => event.id === "projectile.spawn.commit").length,
        ruleClips: ruleClips.length,
        primaryClips: ruleClips.filter((event) =>
          sourceFor(event) === "unanswering_feed-p1-primary").length,
        counterClips: ruleClips.filter((event) =>
          sourceFor(event) === "unanswering_feed-p1-counter").length,
        outOfBounds: events.filter((event) =>
          event.id === "projectile.cancel.commit"
          && event.payload.reason === "out_of_bounds").length,
        patternEnd: events.filter((event) =>
          event.id === "projectile.cancel.commit"
          && event.payload.reason === "pattern_end").length,
        firstClipTick: ruleClips[0]?.tick120,
        lastClipTick: ruleClips.at(-1)?.tick120,
      }).toEqual({
        totalCandidates: expected[difficulty].candidates,
        laneOmissions: 0,
        rngCalls: expected[difficulty].candidates,
        spawnCommits: expected[difficulty].candidates,
        ruleClips: expected[difficulty].ruleClips,
        primaryClips: expected[difficulty].primaryClips,
        counterClips: expected[difficulty].counterClips,
        outOfBounds: expected[difficulty].outOfBounds,
        patternEnd: expected[difficulty].patternEnd,
        firstClipTick: expected[difficulty].firstClipTick,
        lastClipTick: expected[difficulty].lastClipTick,
      });
      expect([...observedSources].sort()).toEqual([
        "unanswering_feed-p1-counter",
        "unanswering_feed-p1-primary",
      ]);
      expect(events.filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
      expect(events.filter((event) => event.id === "player.damage.commit")).toEqual([]);
      expect(kernel.snapshot().lastDamageBatch).toBeNull();
      expect(kernel.snapshot().projectiles.every((projectile) => projectile.state === "residue"))
        .toBe(true);
    }
  });

  it("commits a rule clip before contact and cannot double-terminal the projectile", () => {
    const pattern = executablePattern("boss.unanswering_feed.phase1");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.unanswering_feed.phase1"),
      seed: UNANSWERING_FEED_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 384; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    const clip = kernel.events().find((event) =>
      event.tick120 === 384
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "source_withdrawn");
    expect(clip).toBeDefined();
    const clipEvents = kernel.events().filter((event) =>
      event.tick120 === 384
      && event.payload.instanceId === clip?.payload.instanceId
      && event.payload.generation === clip?.payload.generation);
    expect(clipEvents.map((event) => event.id)).toEqual([
      "projectile.collision.off",
      "projectile.cancel.commit",
      "projectile.residue.begin",
    ]);
    expect(clipEvents.map((event) => event.phasePriority)).toEqual([0, 1, 1]);
    expect(clipEvents.map((event) => event.localSequence)).toEqual(
      [...clipEvents.map((event) => event.localSequence)].sort((left, right) => left - right),
    );
    expect(kernel.events().some((event) =>
      event.tick120 === 384
      && (event.id === "projectile.impact.commit" || event.id === "player.damage.commit")))
      .toBe(false);
    expect(kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === clip?.payload.instanceId
      && projectile.generation === clip?.payload.generation)).toMatchObject({
      sourceId: "unanswering_feed-p1-primary",
      state: "residue",
      collisionEnabled: false,
      terminalCause: "cancel",
    });
  });

  it("is render-cadence invariant for visible unanswering-feed clips", () => {
    const targetTick120 = 600;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveUnansweringFeedWithDeltas(
      Array.from({length: 150}, () => 1000 / 30),
      targetTick120,
    );
    const at144Hz = driveUnansweringFeedWithDeltas(
      Array.from({length: 720}, () => 1000 / 144),
      targetTick120,
    );
    const retainedBacklog = driveUnansweringFeedWithDeltas([durationMs], targetTick120);
    expect(at30Hz.events().some((event) =>
      event.id === "projectile.cancel.commit"
      && event.payload.reason === "source_withdrawn")).toBe(true);
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(retainedBacklog.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(retainedBacklog.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("ends unanswering-feed flight at 1548 and drains authored residue at 1856", () => {
    const pattern = executablePattern("boss.unanswering_feed.phase1");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.unanswering_feed.phase1"),
      seed: UNANSWERING_FEED_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 1548; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(crossedTickCount(pattern.durationMs)).toBe(1548);
    expect(crossedTickCount(2559)).toBe(308);
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1548,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles.length).toBeGreaterThan(0);
    expect(kernel.snapshot().projectiles.every((projectile) => projectile.state === "residue"))
      .toBe(true);
    expect(kernel.events().filter((event) =>
      event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toHaveLength(24);

    for (let tick120 = 1549; tick120 <= 1855; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1855,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    kernel.step(safeGapFollowingInput(kernel, pattern, 1856));
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1856,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
  });

  it("pins the immutable paired-fan contract and exact Python-oracle candidate ordering", () => {
    const kernel = new CanonicalCombatKernel(optionsFor("room.forced.unstable_middle"));
    const contract = kernel.patternContractSnapshot();
    expect(contract).toMatchObject({
      id: "room.forced.unstable_middle",
      room: "FORCED_ALIGNMENT",
      durationMs: 11600,
      warning: {
        durationMs: 594,
        shape: "mirrored_turn_union",
        coversSweptArea: true,
        collisionEnabled: false,
      },
      safeGap: {
        type: "breathing_seam",
        minimumWidthPx: 28,
        enforcement: "angular_omission",
        path: {centerX: 180, amplitudePx: 18, periodMs: 4600, maxTravelPxPerSec: 78},
      },
      residue: {type: "seam_filament", lifetimeMs: 3458, gameplayCollision: false},
    });
    expect(contract.emitters.map((emitter) => ({
      id: emitter.id,
      anchor: emitter.anchor,
      geometry: emitter.geometry,
      operators: emitter.motionStack.map((entry) => entry.operator),
      turn: emitter.motionStack[1]?.params,
    }))).toEqual([
      {
        id: "claim-a",
        anchor: {space: "viewport-normalized", x: 0.18, y: 0.12},
        geometry: {
          type: "paired_fan",
          variant: "mirror-left",
          count: 10,
          baseAngleDeg: 68,
          spreadDeg: 82,
          ordering: "clockwise-then-source-index",
        },
        operators: ["op.linear", "op.turn_once"],
        turn: {atMs: 880, deltaDeg: 16},
      },
      {
        id: "claim-b",
        anchor: {space: "viewport-normalized", x: 0.82, y: 0.12},
        geometry: {
          type: "paired_fan",
          variant: "mirror-right",
          count: 10,
          baseAngleDeg: 112,
          spreadDeg: 82,
          ordering: "clockwise-then-source-index",
        },
        operators: ["op.linear", "op.turn_once"],
        turn: {atMs: 880, deltaDeg: -16},
      },
    ]);

    const expectedCounts = {EASY: 8, NORMAL: 10, HARD: 12} as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const count = roundPatternCount(
        10 * contract.difficulty[difficulty].countMultiplier,
      );
      expect(count).toBe(expectedCounts[difficulty]);
      for (const emitter of contract.emitters) {
        const candidates = geometryCandidates(emitter, 0, count);
        expect(candidates).toHaveLength(count);
        candidates.forEach((candidate, index) => {
          expect(candidate.sourceIndex).toBe(index);
          expect(candidate.x).toBeCloseTo(
            emitter.anchor.x * 360 + (index % 2 === 0 ? -8 : 8),
            12,
          );
          expect(candidate.y).toBeCloseTo(emitter.anchor.y * 640, 12);
        });
      }
    }
    expect(geometryCandidates(contract.emitters[0]!, 0, 10).slice(0, 4)).toEqual([
      {x: 56.8, y: 76.8, headingDeg: 59.8, sourceIndex: 0},
      {x: 72.8, y: 76.8, headingDeg: 76.2, sourceIndex: 1},
      {x: 56.8, y: 76.8, headingDeg: 43.4, sourceIndex: 2},
      {x: 72.8, y: 76.8, headingDeg: 92.6, sourceIndex: 3},
    ]);
    expect(geometryCandidates(contract.emitters[1]!, 0, 10).slice(0, 4)).toEqual([
      {x: 287.2, y: 76.8, headingDeg: 103.8, sourceIndex: 0},
      {x: 303.2, y: 76.8, headingDeg: 120.2, sourceIndex: 1},
      {x: 287.2, y: 76.8, headingDeg: 87.4, sourceIndex: 2},
      {x: 303.2, y: 76.8, headingDeg: 136.6, sourceIndex: 3},
    ]);

    const oracle = simulatePattern("room.forced.unstable_middle", {
      seed: UNSTABLE_MIDDLE_REPORT_SEED,
    });
    expect(oracle.traceSha256).toBe(
      "8030fff7372846512ad3f2d47c792a90f5e0d157e9406403349874931b2dffca",
    );
    expect(oracle.events).toHaveLength(18);
    expect(oracle.omittedOrRedirected).toBe(10);
    expect(oracle.splitChildren).toBe(0);
  });

  it("fails closed on paired-fan geometry drift without invoking accessors", () => {
    const valid = {
      type: "paired_fan",
      variant: "mirror-left",
      count: 10,
      baseAngleDeg: 68,
      spreadDeg: 82,
      ordering: "clockwise-then-source-index",
    } as const;
    expect(() => validatePairedFanGeometryContract(valid)).not.toThrow();
    for (const invalid of [
      {...valid, type: "fan"},
      {...valid, ordering: "source-index-then-clockwise"},
      {...valid, variant: ""},
      {...valid, count: 0},
      {...valid, count: 1.5},
      {...valid, baseAngleDeg: -1},
      {...valid, spreadDeg: Number.POSITIVE_INFINITY},
      {...valid, extraRule: "unowned"},
      {
        type: "paired_fan",
        variant: "mirror-left",
        count: 10,
        baseAngleDeg: 68,
        spreadDeg: 82,
      },
    ]) {
      expect(() => validatePairedFanGeometryContract(invalid)).toThrow();
    }

    let reads = 0;
    const accessorGeometry = Object.defineProperty(
      {
        type: "paired_fan",
        variant: "mirror-left",
        baseAngleDeg: 68,
        spreadDeg: 82,
        ordering: "clockwise-then-source-index",
      },
      "count",
      {
        enumerable: true,
        get() {
          reads += 1;
          return 10;
        },
      },
    );
    expect(() => validatePairedFanGeometryContract(accessorGeometry)).toThrow(/own data property/);
    expect(reads).toBe(0);
  });

  it("preserves paired-fan cadence and turns after the crossed tick's old-heading motion", () => {
    const pattern = executablePattern("room.forced.unstable_middle");
    const schedule = createPatternSchedule(pattern, "NORMAL");
    expect(schedule).toHaveLength(18);
    expect(schedule.slice(0, 4).map((entry) => ({
      source: entry.emitter.id,
      burst: entry.burstIndex,
      atMs: entry.atMs,
      tick120: crossedTickCount(entry.atMs),
    }))).toEqual([
      {source: "claim-a", burst: 0, atMs: 594, tick120: 72},
      {source: "claim-b", burst: 0, atMs: 774, tick120: 93},
      {source: "claim-a", burst: 1, atMs: 1674, tick120: 201},
      {source: "claim-b", burst: 1, atMs: 1854, tick120: 223},
    ]);

    const startTick120 = 500;
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.unstable_middle"),
      startTick120,
    });
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    const projectile = (sourceId: string) => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === sourceId && entry.burstIndex === 0 && entry.sourceIndex === 0);
      expect(candidate, sourceId).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };

    expect(startTick120 + crossedTickCount(594 + 880)).toBe(677);
    stepTo(676);
    const beforeA = projectile("claim-a");
    stepTo(677);
    const turnedA = projectile("claim-a");
    expect(turnedA.headingDegrees - beforeA.headingDegrees).toBeCloseTo(16, 12);
    expect(turnedA.position.x).toBeCloseTo(
      beforeA.position.x + Math.cos(beforeA.headingDegrees * Math.PI / 180)
        * turnedA.speedPxPerSecond / 120,
      12,
    );
    expect(turnedA.position.y).toBeCloseTo(
      beforeA.position.y + Math.sin(beforeA.headingDegrees * Math.PI / 180)
        * turnedA.speedPxPerSecond / 120,
      12,
    );
    stepTo(678);
    const afterA = projectile("claim-a");
    expect(afterA.headingDegrees).toBe(turnedA.headingDegrees);
    expect(afterA.position.x).toBeCloseTo(
      turnedA.position.x + Math.cos(turnedA.headingDegrees * Math.PI / 180)
        * afterA.speedPxPerSecond / 120,
      12,
    );
    expect(afterA.position.y).toBeCloseTo(
      turnedA.position.y + Math.sin(turnedA.headingDegrees * Math.PI / 180)
        * afterA.speedPxPerSecond / 120,
      12,
    );

    expect(startTick120 + crossedTickCount(774 + 880)).toBe(699);
    stepTo(698);
    const beforeB = projectile("claim-b");
    stepTo(699);
    const turnedB = projectile("claim-b");
    expect(turnedB.headingDegrees - beforeB.headingDegrees).toBeCloseTo(-16, 12);
    expect(turnedB.position.x).toBeCloseTo(
      beforeB.position.x + Math.cos(beforeB.headingDegrees * Math.PI / 180)
        * turnedB.speedPxPerSecond / 120,
      12,
    );
    expect(turnedB.position.y).toBeCloseTo(
      beforeB.position.y + Math.sin(beforeB.headingDegrees * Math.PI / 180)
        * turnedB.speedPxPerSecond / 120,
      12,
    );
    stepTo(700);
    const afterB = projectile("claim-b");
    expect(afterB.headingDegrees).toBe(turnedB.headingDegrees);
    expect(afterB.position.x).toBeCloseTo(
      turnedB.position.x + Math.cos(turnedB.headingDegrees * Math.PI / 180)
        * afterB.speedPxPerSecond / 120,
      12,
    );
    expect(afterB.position.y).toBeCloseTo(
      turnedB.position.y + Math.sin(turnedB.headingDegrees * Math.PI / 180)
        * afterB.speedPxPerSecond / 120,
      12,
    );
  });

  it("preflights literal pre/post-turn paired-fan paths and pins E/N/H production traces", {
    timeout: 20_000,
  }, () => {
    const expected = {
      EASY: {
        candidates: 144, preflight: 6, spawn: 138, outOfBounds: 94, patternEnd: 44,
        activeResidue: 86, allocated: 96, peakLive: 53, peakResidue: 86, peakBodies: 96,
        endEvents: 1208,
        endHash: "1254d8341e630677096392855d1f683854c38056bb128a904e947d674158ced9",
        fullEvents: 1380,
        fullHash: "2ffd9cd25098d60ff8033812580d73fa7de1b3c2abacf8a2eb0b64ad2cdc0ff0",
      },
      NORMAL: {
        candidates: 180, preflight: 12, spawn: 168, outOfBounds: 137, patternEnd: 31,
        activeResidue: 88, allocated: 125, peakLive: 67, peakResidue: 88, peakBodies: 125,
        endEvents: 1504,
        endHash: "0463a2a5fc3ce212d6cdf551f8c20127a2dbee2e7ccb5ca66ba36272e79eaf26",
        fullEvents: 1680,
        fullHash: "175dd9006058b797fc652d666d14a86aaf79b0add900a57523f63652f65ad44b",
      },
      HARD: {
        candidates: 216, preflight: 12, spawn: 204, outOfBounds: 188, patternEnd: 16,
        activeResidue: 87, allocated: 166, peakLive: 80, peakResidue: 87, peakBodies: 166,
        endEvents: 1866,
        endHash: "f2f0ce3506a8fdfadf32888b76f59365fe92c4ef26614d84a1d73cf7a3243fe0",
        fullEvents: 2040,
        fullHash: "47990c6f57c3492a9a4b03c311137346c12109e5e574fa112db54b7dacbbb052",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.forced.unstable_middle"),
        seed: UNSTABLE_MIDDLE_REPORT_SEED,
        difficulty,
      });
      const pattern = kernel.patternContractSnapshot();
      const facts = expected[difficulty];
      const observedSources = new Set<string>();
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      let peakLive = 0;
      let peakResidue = 0;
      let peakBodies = 0;
      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const relativeMs = snapshot.relativeTick120 * 1000 / 120;
        const corridorCenter = safeGapCenter(pattern, relativeMs);
        peakLive = Math.max(peakLive, snapshot.poolUsage.liveColliders);
        peakResidue = Math.max(peakResidue, snapshot.poolUsage.residueVisuals);
        peakBodies = Math.max(peakBodies, snapshot.projectiles.length);
        for (const projectile of snapshot.projectiles) {
          observedSources.add(projectile.sourceId);
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            minimumCollisionMargin = Math.min(
              minimumCollisionMargin,
              Math.abs(projectile.position.x - corridorCenter) - (
                safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
              ),
            );
          }
        }
      }
      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      const candidates = createPatternSchedule(pattern, difficulty).reduce((total, entry) =>
        total + roundPatternCount(
          entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        ), 0);
      expect([...observedSources].sort()).toEqual(["claim-a", "claim-b"]);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect({
        candidates,
        rng: kernel.snapshot().rngCallsConsumed,
        preflight: kernel.snapshot().rngCallsConsumed - count("projectile.spawn.commit"),
        spawn: count("projectile.spawn.commit"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        impact: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        activeResidue: kernel.snapshot().projectiles.length,
        allocated: kernel.snapshot().poolUsage.allocatedSlots.micro,
        peakLive,
        peakResidue,
        peakBodies,
        eventCount: events.length,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        candidates: facts.candidates,
        rng: facts.candidates,
        preflight: facts.preflight,
        spawn: facts.spawn,
        sourceWithdrawn: 0,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        impact: 0,
        damage: 0,
        activeResidue: facts.activeResidue,
        allocated: facts.allocated,
        peakLive: facts.peakLive,
        peakResidue: facts.peakResidue,
        peakBodies: facts.peakBodies,
        eventCount: facts.endEvents,
        hash: facts.endHash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1392,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        player: {health: 3},
        evidence: {amount: 0},
        poolUsage: {liveColliders: 0, residueVisuals: facts.activeResidue},
      });
      expect(kernel.projectilePoolAudit()).toEqual([]);

      for (let tick120 = 1393; tick120 <= 1807; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      const fullEvents = kernel.events();
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1807,
        projectileLifecycleDrained: true,
        handoffReady: true,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
      });
      expect(fullEvents.filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(facts.spawn);
      expect(fullEvents.filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(facts.spawn);
      expect(fullEvents).toHaveLength(facts.fullEvents);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.fullHash);
    }

  });

  it("is render-cadence invariant for the paired-fan capability", () => {
    const targetTick120 = 400;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveUnstableMiddleWithDeltas(
      Array.from({length: 100}, () => 1000 / 30),
      targetTick120,
    );
    const at144Hz = driveUnstableMiddleWithDeltas(
      Array.from({length: 480}, () => 1000 / 144),
      targetTick120,
    );
    const retainedBacklog = driveUnstableMiddleWithDeltas([durationMs], targetTick120);
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(retainedBacklog.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(retainedBacklog.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("resolves a paired-fan swept hit with collision-off before impact and damage", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.unstable_middle"),
      difficulty: "HARD",
      initialPlayerPosition: {x: 103, y: 570},
    });
    for (let tick120 = 1; tick120 <= 449; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    expect(kernel.snapshot().lastDamageBatch).toMatchObject({
      tick120: 449,
      committedSourceId: "combat:room.forced.unstable_middle/micro/0001:0",
      branch: "non-fatal",
    });
    const events = kernel.events().filter((event) => event.tick120 === 449);
    const projectileCollisionOff = events.findIndex((event) =>
      event.id === "projectile.collision.off");
    const impact = events.findIndex((event) => event.id === "projectile.impact.commit");
    const damage = events.findIndex((event) => event.id === "player.damage.commit");
    expect(projectileCollisionOff).toBeGreaterThanOrEqual(0);
    expect(impact).toBeGreaterThan(projectileCollisionOff);
    expect(damage).toBeGreaterThan(projectileCollisionOff);
    expect(events[projectileCollisionOff]?.phasePriority).toBe(0);
    expect(events[impact]?.phasePriority).toBe(1);
    expect(events[damage]?.phasePriority).toBe(1);
  });

  it("cancels paired-fan flight at pattern end and drains only after authored residue", () => {
    const kernel = new CanonicalCombatKernel(optionsFor("room.forced.unstable_middle"));
    for (let tick120 = 1; tick120 <= 1392; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1392,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles.length).toBeGreaterThan(0);
    expect(kernel.snapshot().projectiles.every((projectile) => projectile.state === "residue"))
      .toBe(true);
    expect(kernel.events().some((event) =>
      event.tick120 === 1392
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toBe(true);

    for (let tick120 = 1393; tick120 <= 1806; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1806,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    kernel.step({...inputAt(1807), focused: false});
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1807,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
  });

  it("uses one stable RNG stream across the two-emitter unanswered fan", () => {
    const kernel = new CanonicalCombatKernel(optionsFor("room.information.unanswered_fan"));
    for (let tick120 = 1; tick120 <= 112; tick120 += 1) kernel.step(inputAt(tick120));
    const sourceIds = new Set(kernel.snapshot().projectiles.map((projectile) => projectile.sourceId));
    expect(sourceIds).toContain("question-fan");
    expect(sourceIds).toContain("late-echo");
    const identities = kernel.snapshot().projectiles.map((projectile) =>
      `${projectile.instanceId}:${projectile.generation}`);
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("pins the immutable stale-packet line, retry envelope, and dual compiler provenance", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.information.stale_packet_retry"),
      seed: STALE_PACKET_RETRY_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(contract).toMatchObject({
      id: "room.information.stale_packet_retry",
      category: "ROOM",
      room: "INFORMATION",
      durationMs: 9800,
      warning: {
        durationMs: 689,
        shape: "broken_packet_columns",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      safeGap: {
        type: "static_void",
        minimumWidthPx: 34,
        focusMinimumWidthPx: 26,
        enforcement: "spawn_omission",
        path: {
          centerX: 180,
          amplitudePx: 0,
          periodMs: 6000,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
      },
      residue: {
        type: "packet_dust",
        lifetimeMs: 3978,
        density: 0.37,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
    });
    expect(contract.emitters).toEqual([expect.objectContaining({
      id: "retry-lines",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
      geometry: {
        type: "line",
        variant: "missing-columns",
        count: 11,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 689, intervalMs: 820, bursts: 10, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {
        type: "piecewise-linear",
        keys: [{atMs: 0, pxPerSec: 126}, {atMs: 1120, pxPerSec: 174}],
      },
      motionStack: [
        {operator: "op.linear", params: {}},
        {
          operator: "op.speed_envelope",
          params: {
            keys: [
              {atMs: 0, multiplier: 1},
              {atMs: 620, multiplier: 0},
              {atMs: 1120, multiplier: 1.35},
            ],
            interpolation: "step",
          },
        },
      ],
    })]);

    const expected = {
      EASY: {
        candidates: 90,
        referenceInterventions: 10,
        referenceHash: "db61c29f5b16f78984f56a3590a23b271eb1ab48a86594cc2bd125d26f9562b1",
        declaredInterventions: 10,
        declaredHash: "def2f8c722466a5350fa95b769ed08f89f670eef80a6379d013efa2f533e1f6d",
      },
      NORMAL: {
        candidates: 110,
        referenceInterventions: 12,
        referenceHash: "68ea9d2c2c42ae459dc689dc0d8c4f08901317050611be8d6a3c26ec9e1dc14f",
        declaredInterventions: 13,
        declaredHash: "36e6c1492e0d82d762ab0d99ec8540ee62211cf89f80cbbdcdc2f771e6de3c97",
      },
      HARD: {
        candidates: 130,
        referenceInterventions: 15,
        referenceHash: "9852e037849cfcfd3862c64d7218ca95846803c11790d5e12bf82f82c4495b87",
        declaredInterventions: 15,
        declaredHash: "6d95b031c7a60f9a5a6c80824771ccb9636ec615f7a85c14b5e2702c68aeaf5b",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: STALE_PACKET_RETRY_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: STALE_PACKET_RETRY_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect({
        emissions: reference.events.length,
        candidates: reference.events.reduce((total, event) => total + event.count, 0),
        interventions: reference.omittedOrRedirected,
        splitChildren: reference.splitChildren,
        hash: reference.traceSha256,
      }).toEqual({
        emissions: 10,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].referenceInterventions,
        splitChildren: 0,
        hash: expected[difficulty].referenceHash,
      });
      expect({
        emissions: declared.events.length,
        candidates: declared.events.reduce((total, event) => total + event.count, 0),
        interventions: declared.omittedOrRedirected,
        splitChildren: declared.splitChildren,
        hash: declared.traceSha256,
      }).toEqual({
        emissions: 10,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].declaredInterventions,
        splitChildren: 0,
        hash: expected[difficulty].declaredHash,
      });
      expect(declared.traceSha256).not.toBe(reference.traceSha256);
    }
  });

  it("fails closed on hostile piecewise-linear curve and line-geometry records", () => {
    const validCurve = {
      type: "piecewise-linear",
      keys: [{atMs: 0, pxPerSec: 126}, {atMs: 1120, pxPerSec: 174}],
    } as const;
    expect(() => validatePiecewiseLinearSpeedCurveParameters(validCurve)).not.toThrow();
    for (const invalid of [
      {keys: validCurve.keys},
      {...validCurve, type: "step"},
      {...validCurve, extra: true},
      {...validCurve, keys: []},
      {...validCurve, keys: [{atMs: 1, pxPerSec: 126}]},
      {...validCurve, keys: [{atMs: 0, pxPerSec: 126}, {atMs: 0, pxPerSec: 174}]},
      {...validCurve, keys: [{atMs: 0, pxPerSec: 126}, {atMs: -0, pxPerSec: 174}]},
      {...validCurve, keys: [{atMs: 0, pxPerSec: 126}, {
        atMs: Number.MAX_SAFE_INTEGER + 1,
        pxPerSec: 174,
      }]},
      {...validCurve, keys: [{atMs: 0, pxPerSec: -0}]},
      {...validCurve, keys: [{atMs: 0, pxPerSec: Number.NaN}]},
      {...validCurve, keys: [{atMs: 0, pxPerSec: 126, extra: true}]},
    ]) {
      expect(() => validatePiecewiseLinearSpeedCurveParameters(
        invalid as unknown as Readonly<Record<string, unknown>>,
      )).toThrow();
    }

    const sparse = Array(3) as unknown[];
    sparse[0] = {atMs: 0, pxPerSec: 126};
    sparse[2] = {atMs: 1120, pxPerSec: 174};
    expect(() => validatePiecewiseLinearSpeedCurveParameters({
      type: "piecewise-linear",
      keys: sparse,
    })).toThrow(/dense/);
    const metadata = [...validCurve.keys] as Array<unknown> & {metadata?: boolean};
    metadata.metadata = true;
    expect(() => validatePiecewiseLinearSpeedCurveParameters({
      type: "piecewise-linear",
      keys: metadata,
    })).toThrow(/metadata/);
    let keyReads = 0;
    const accessorKey = Object.defineProperty({pxPerSec: 126}, "atMs", {
      enumerable: true,
      get() {
        keyReads += 1;
        return 0;
      },
    });
    expect(() => validatePiecewiseLinearSpeedCurveParameters({
      type: "piecewise-linear",
      keys: [accessorKey],
    })).toThrow(/own data property/);
    expect(keyReads).toBe(0);
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(() => validatePiecewiseLinearSpeedCurveParameters({
      type: "piecewise-linear",
      keys: revoked.proxy,
    })).toThrow(/inspected safely/);

    const validLine = {
      type: "line",
      variant: "missing-columns",
      count: 11,
      baseAngleDeg: 90,
      spreadDeg: 0,
      ordering: "clockwise-then-source-index",
    } as const;
    expect(() => validateLineGeometryContract(validLine)).not.toThrow();
    expect(() => validateLineGeometryContract({...validLine, extra: true})).toThrow(/contract drifted/);
    expect(() => validateLineGeometryContract({...validLine, type: "wall"})).toThrow(/must be line/);
    expect(() => validateLineGeometryContract({...validLine, count: 0})).toThrow(/positive/);
    expect(() => validateLineGeometryContract({...validLine, ordering: "source-index"}))
      .toThrow(/clockwise-then-source-index/);
  });

  it("keeps exact stale-packet spawn, arm, pause, and retry crossings across E/N/H", () => {
    const pattern = executablePattern("room.information.stale_packet_retry");
    const expected = {
      EASY: {
        spawn: [83, 197, 311, 426, 540, 654, 768, 882, 996, 1110],
        arm: [88, 202, 316, 430, 545, 659, 773, 887, 1001, 1115],
        pause: [158, 272, 386, 500, 614, 728, 842, 957, 1071, 1185],
        retry: [218, 332, 446, 560, 674, 788, 902, 1017, 1131, 1245],
      },
      NORMAL: {
        spawn: [83, 182, 280, 378, 477, 575, 674, 772, 870, 969],
        arm: [88, 186, 285, 383, 482, 580, 678, 777, 875, 974],
        pause: [158, 256, 354, 453, 551, 650, 748, 846, 945, 1043],
        retry: [218, 316, 414, 513, 611, 710, 808, 906, 1005, 1103],
      },
      HARD: {
        spawn: [83, 170, 256, 343, 430, 516, 603, 689, 776, 863],
        arm: [88, 175, 261, 348, 434, 521, 608, 694, 781, 867],
        pause: [158, 244, 331, 417, 504, 591, 677, 764, 850, 937],
        retry: [218, 304, 391, 477, 564, 651, 737, 824, 910, 997],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(
        expected[difficulty].spawn,
      );
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expected[difficulty].arm);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 620))).toEqual(
        expected[difficulty].pause,
      );
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 1120))).toEqual(
        expected[difficulty].retry,
      );
    }
    const easyFinalBurst = createPatternSchedule(pattern, "EASY").at(-1);
    // The immutable Python QA scheduler and manifest-derived TS scheduler retain
    // all ten bursts although the scaled final burst follows the 9100ms marker.
    expect(easyFinalBurst?.atMs).toBeCloseTo(9249.8, 10);
    expect(crossedTickCount(easyFinalBurst?.atMs ?? Number.NaN)).toBe(1110);

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.information.stale_packet_retry"),
      seed: STALE_PACKET_RETRY_REPORT_SEED,
    });
    const projectile = () => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === "retry-lines" && entry.burstIndex === 0 && entry.sourceIndex === 0);
      expect(candidate).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
    };
    stepTo(83);
    expect(projectile()).toMatchObject({
      state: "arm",
      spawnedAtTick: 83,
      armAtTick: 88,
      position: {x: 30.90909090909091, y: 102.4},
      speedPxPerSecond: 126,
      collisionEnabled: false,
    });
    stepTo(88);
    expect(projectile()).toMatchObject({
      state: "flight",
      position: {x: 30.90909090909091, y: 102.4},
      speedPxPerSecond: 126,
      collisionEnabled: true,
    });
    stepTo(89);
    expect(projectile().speedPxPerSecond).toBeCloseTo(128.25714285714287, 12);
    expect(projectile().position.y).toBeCloseTo(103.46732142857144, 12);
    stepTo(157);
    const beforePause = projectile();
    expect(beforePause.speedPxPerSecond).toBeCloseTo(152.54285714285714, 12);
    expect(beforePause.position.y).toBeCloseTo(183.02732142857124, 12);
    stepTo(158);
    const paused = projectile();
    expect(paused.speedPxPerSecond).toBe(0);
    expect(paused.position.y).toBeCloseTo(183.12902619047597, 12);
    expect(paused.position.y - beforePause.position.y).toBeCloseTo(0.10170476190473, 12);
    stepTo(217);
    expect(projectile()).toMatchObject({position: paused.position, speedPxPerSecond: 0});
    stepTo(218);
    const retried = projectile();
    expect(retried.speedPxPerSecond).toBeCloseTo(234.9, 12);
    expect(retried.position.y).toBeCloseTo(184.92992619047598, 12);
    expect(retried.position.y - paused.position.y).toBeCloseTo(1.8009, 12);
    stepTo(219);
    expect(projectile().position.y - retried.position.y).toBeCloseTo(234.9 / 120, 12);
  });

  it("preflights stale-packet retries with the same curve-envelope sweep used at runtime", () => {
    const pattern = executablePattern("room.information.stale_packet_retry");
    const expected = {
      EASY: {candidates: 90, preflight: 10, spawn: 80, outOfBounds: 45, patternEnd: 35},
      NORMAL: {candidates: 110, preflight: 13, spawn: 97, outOfBounds: 67, patternEnd: 30},
      HARD: {candidates: 130, preflight: 15, spawn: 115, outOfBounds: 104, patternEnd: 11},
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.information.stale_packet_retry"),
        seed: STALE_PACKET_RETRY_REPORT_SEED,
        difficulty,
      });
      const schedule = createPatternSchedule(pattern, difficulty);
      const candidates = schedule.reduce((total, scheduled) => total + roundPatternCount(
        scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      ), 0);
      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, snapshot.relativeTick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }
      const events = kernel.events();
      const spawnCommits = events.filter((event) => event.id === "projectile.spawn.commit").length;
      const countCancellation = (reason: string): number => events.filter((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === reason).length;
      expect({
        candidates,
        preflight: kernel.snapshot().rngCallsConsumed - spawnCommits,
        spawn: spawnCommits,
        outOfBounds: countCancellation("out_of_bounds"),
        patternEnd: countCancellation("pattern_end"),
      }).toEqual(expected[difficulty]);
      expect(kernel.snapshot().rngCallsConsumed).toBe(candidates);
      expect(countCancellation("out_of_bounds") + countCancellation("pattern_end"))
        .toBe(spawnCommits);
      expect(countCancellation("source_withdrawn")).toBe(0);
      expect(events.filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
      expect(events.filter((event) => event.id === "player.damage.commit")).toEqual([]);
      expect(kernel.projectilePoolAudit()).toEqual([]);
    }
  });

  it("subdivides stale-packet retry contact at the release key before same-tick damage", () => {
    const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
    const pausedProjectileY = 183.12902619047597;
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.information.stale_packet_retry"),
      seed: STALE_PACKET_RETRY_REPORT_SEED,
      initialPlayerPosition: {x: 60, y: pausedProjectileY + 5.1},
    });
    for (let tick120 = 1; tick120 <= 217; tick120 += 1) {
      kernel.step({
        ...inputAt(tick120),
        focused: false,
        movement: tick120 >= 159 && tick120 <= 176
          ? {x: -1, y: 0}
          : tick120 === 177
            ? {x: -0.5686653771760153, y: 0}
            : {x: 0, y: 0},
      });
    }
    expect(kernel.snapshot().lastDamageBatch).toBeNull();
    expect(kernel.snapshot().playerPosition.x).toBeCloseTo(30.909090909090853, 12);
    expect(kernel.snapshot().playerPosition.y).toBeCloseTo(pausedProjectileY + 5.1, 12);
    expect(kernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceId === "retry-lines"
      && projectile.burstIndex === 0
      && projectile.sourceIndex === 0)).toMatchObject({
        state: "flight",
        position: {x: 30.90909090909091, y: pausedProjectileY},
        speedPxPerSecond: 0,
        collisionEnabled: true,
      });
    kernel.step({...inputAt(218), focused: false, movement: {x: 0, y: 0}});
    expect(kernel.snapshot().lastDamageBatch).toMatchObject({
      tick120: 218,
      committedSourceId: "combat:room.information.stale_packet_retry/micro/0000:0",
      branch: "non-fatal",
    });
    const events = kernel.events().filter((event) => event.tick120 === 218);
    const projectileCollisionOff = events.findIndex((event) =>
      event.id === "projectile.collision.off");
    const impact = events.findIndex((event) => event.id === "projectile.impact.commit");
    const damage = events.findIndex((event) => event.id === "player.damage.commit");
    expect(projectileCollisionOff).toBeGreaterThanOrEqual(0);
    expect(impact).toBeGreaterThan(projectileCollisionOff);
    expect(damage).toBeGreaterThan(projectileCollisionOff);
    expect(events[projectileCollisionOff]?.phasePriority).toBe(0);
    expect(events[impact]?.phasePriority).toBe(1);
    expect(events[damage]?.phasePriority).toBe(1);
    expect(kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === "combat:room.information.stale_packet_retry/micro/0000"))
      .toMatchObject({
        sourceId: "retry-lines",
        state: "residue",
        collisionEnabled: false,
        speedPxPerSecond: 234.9,
      });
    expect(maximumTravel).toBe(1.5666666666666667);
  });

  it("is render-cadence invariant through stale-packet pause and retry boundaries", () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveStalePacketRetryWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
    );
    const at144Hz = driveStalePacketRetryWithDeltas(
      Array.from({length: 504}, () => 1000 / 144),
      targetTick120,
    );
    const retainedBacklog = driveStalePacketRetryWithDeltas([durationMs], targetTick120);
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(retainedBacklog.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(retainedBacklog.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("ends stale-packet flight at 1176 and drains 478 ticks of packet dust at 1654", () => {
    const pattern = executablePattern("room.information.stale_packet_retry");
    expect(crossedTickCount(pattern.durationMs)).toBe(1176);
    expect(crossedTickCount(3978)).toBe(478);
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.information.stale_packet_retry"),
      seed: STALE_PACKET_RETRY_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 1176; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1176,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
      poolUsage: {liveColliders: 0},
    });
    expect(kernel.snapshot().projectiles).toHaveLength(78);
    expect(kernel.snapshot().projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(kernel.events().filter((event) =>
      event.tick120 === 1176
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toHaveLength(30);

    for (let tick120 = 1177; tick120 <= 1653; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1653,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles).toHaveLength(30);
    kernel.step(safeGapFollowingInput(kernel, pattern, 1654));
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1654,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(kernel.events().filter((event) =>
      event.tick120 === 1654 && event.id === "projectile.residue.remove")).toHaveLength(30);
  });

  it("pins Notification Overflow as one immutable grid-field capability with layered QA evidence", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.information.notification_overflow"),
      seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract).toMatchObject({
      id: "room.information.notification_overflow",
      category: "ROOM",
      room: "INFORMATION",
      durationMs: 11200,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 566, event: "collision.arm"},
        {atMs: 566, event: "emit.begin"},
        {atMs: 5600, event: "pattern.midpoint"},
        {atMs: 10500, event: "emit.end"},
        {atMs: 10780, event: "residue.commit"},
        {atMs: 11200, event: "pattern.complete"},
      ],
      warning: {
        durationMs: 566,
        shape: "falling_lane_projection",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      safeGap: {
        type: "moving_window",
        minimumWidthPx: 38,
        focusMinimumWidthPx: 30,
        enforcement: "lane_omission",
        path: {
          centerX: 180,
          amplitudePx: 74,
          periodMs: 8400,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        readability: {leadMs: 520, neverColorOnly: true},
      },
      residue: {
        type: "packet_dust",
        lifetimeMs: 2425,
        density: 0.22,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      seed: {base: 1205727364},
    });
    expect("laserGeometry" in contract).toBe(false);
    expect(contract.emitters).toEqual([expect.objectContaining({
      id: "packet-rain",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.02},
      geometry: {
        type: "grid",
        variant: "staggered-rain",
        count: 15,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 566, intervalMs: 620, bursts: 16, intraBurstMs: 0},
      projectile: {archetype: "bullet.micro.dash", collisionRadiusPx: 2, armDelayMs: 40},
      speedCurve: {
        type: "piecewise-linear",
        keys: [{atMs: 0, pxPerSec: 112}, {atMs: 1600, pxPerSec: 154}],
      },
      motionStack: [
        {operator: "op.lateral_wall", params: {laneCount: 15, openLane: 7, driftPxPerSec: 11}},
        {
          operator: "op.local_vector_bias",
          params: {vectorPxPerSec: [12, 18], pulsePeriodMs: 1800, pulseAmount: 0.45},
        },
        {operator: "op.linear", params: {}},
      ],
    })]);

    const expected = {
      EASY: {
        emissions: 15,
        candidates: 180,
        referenceInterventions: 32,
        referenceHash: "228260d84b23305c34c67f49d1da7d758aa3669676338a1e2afa60a08e948c06",
        declaredInterventions: 28,
        declaredHash: "5ca61c5698e664a115f043235f13b2d1118edfa686e8060d14df8aac662691d9",
      },
      NORMAL: {
        emissions: 16,
        candidates: 240,
        referenceInterventions: 42,
        referenceHash: "c4c0c449f2b4a3c337f33078d5f3bc8aadb5e8faebc420b97ea3c151039bb2a3",
        declaredInterventions: 39,
        declaredHash: "16813e42231a1431a2fc0344a0da096e04d56705a5a5c62e57407302a056d4ad",
      },
      HARD: {
        emissions: 16,
        candidates: 288,
        referenceInterventions: 54,
        referenceHash: "bdbe90817bcba6a90fce23fc828622cfc06548c9c8d32661145cf6b703158cea",
        declaredInterventions: 45,
        declaredHash: "48b686a6105de1314c70e710d2b0f1c2515c9ca47f9100ce1557c16ac9644a8f",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect({
        emissions: reference.events.length,
        candidates: reference.events.reduce((total, event) => total + event.count, 0),
        interventions: reference.omittedOrRedirected,
        splitChildren: reference.splitChildren,
        hash: reference.traceSha256,
      }).toEqual({
        emissions: expected[difficulty].emissions,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].referenceInterventions,
        splitChildren: 0,
        hash: expected[difficulty].referenceHash,
      });
      expect({
        emissions: declared.events.length,
        candidates: declared.events.reduce((total, event) => total + event.count, 0),
        interventions: declared.omittedOrRedirected,
        splitChildren: declared.splitChildren,
        hash: declared.traceSha256,
      }).toEqual({
        emissions: expected[difficulty].emissions,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].declaredInterventions,
        splitChildren: 0,
        hash: expected[difficulty].declaredHash,
      });
      expect(declared.traceSha256).not.toBe(reference.traceSha256);
    }
  });

  it("rejects hostile Notification Overflow grid and local-vector records before execution", () => {
    const grid = {
      type: "grid",
      variant: "staggered-rain",
      count: 15,
      baseAngleDeg: 90,
      spreadDeg: 0,
      ordering: "clockwise-then-source-index",
    } as const;
    expect(() => validateGridGeometryContract(grid)).not.toThrow();
    expect(() => validateGridGeometryContract({...grid, type: "wall"})).toThrow(/type/);
    expect(() => validateGridGeometryContract({...grid, count: 0})).toThrow(/count/);
    expect(() => validateGridGeometryContract({...grid, metadata: "write-back"}))
      .toThrow(/contract|keys/);
    let variantReads = 0;
    const accessorGrid = Object.defineProperty({...grid}, "variant", {
      enumerable: true,
      get() {
        variantReads += 1;
        return "staggered-rain";
      },
    });
    expect(() => validateGridGeometryContract(accessorGrid)).toThrow(/own data property/);
    expect(variantReads).toBe(0);

    const localVector = {
      vectorPxPerSec: [12, 18],
      pulsePeriodMs: 1800,
      pulseAmount: 0.45,
    } as const;
    expect(() => validateLocalVectorBiasParameters(localVector)).not.toThrow();
    expect(() => validateLocalVectorBiasParameters({...localVector, vectorPxPerSec: [12]}))
      .toThrow(/exactly two/);
    expect(() => validateLocalVectorBiasParameters({...localVector, vectorPxPerSec: [12, Number.NaN]}))
      .toThrow(/finite/);
    expect(() => validateLocalVectorBiasParameters({...localVector, vectorPxPerSec: [12, -0]}))
      .toThrow(/negative zero/);
    expect(() => validateLocalVectorBiasParameters({...localVector, pulsePeriodMs: 0}))
      .toThrow(/pulsePeriodMs/);
    expect(() => validateLocalVectorBiasParameters({...localVector, weatherRng: true}))
      .toThrow(/contract|keys/);
    const sparseVector = Array(2) as number[];
    sparseVector[0] = 12;
    expect(() => validateLocalVectorBiasParameters({...localVector, vectorPxPerSec: sparseVector}))
      .toThrow(/dense/);
    let vectorReads = 0;
    const accessorVector = Object.defineProperty([12, 18], "0", {
      enumerable: true,
      get() {
        vectorReads += 1;
        return 12;
      },
    });
    expect(() => validateLocalVectorBiasParameters({...localVector, vectorPxPerSec: accessorVector}))
      .toThrow(/data element/);
    expect(vectorReads).toBe(0);
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("room.information.notification_overflow"),
      projectilePoolClasses: {"bullet.micro.dash": "medium"},
    })).toThrow(/pool mapping disagrees|pool-class mapping|pool class/i);
  });

  it("keeps exact Notification Overflow cadence, arm, rising speed, and fixed-tick field motion", () => {
    const pattern = executablePattern("room.information.notification_overflow");
    const expected = {
      EASY: {
        spawn: [68, 155, 241, 327, 414, 500, 586, 673, 759, 845, 931, 1018, 1104, 1190, 1277],
        arm: [73, 160, 246, 332, 418, 505, 591, 677, 764, 850, 936, 1023, 1109, 1195, 1281],
      },
      NORMAL: {
        spawn: [68, 143, 217, 292, 366, 440, 515, 589, 664, 738, 812, 887, 961, 1036, 1110, 1184],
        arm: [73, 148, 222, 296, 371, 445, 520, 594, 668, 743, 817, 892, 966, 1040, 1115, 1189],
      },
      HARD: {
        spawn: [68, 134, 199, 265, 330, 396, 461, 527, 592, 658, 723, 789, 854, 920, 985, 1050],
        arm: [73, 139, 204, 270, 335, 401, 466, 532, 597, 662, 728, 793, 859, 924, 990, 1055],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(
        expected[difficulty].spawn,
      );
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expected[difficulty].arm);
    }
    const easyFinalBurst = createPatternSchedule(pattern, "EASY").at(-1);
    expect(easyFinalBurst?.atMs).toBeCloseTo(10634.8, 10);
    expect(easyFinalBurst?.atMs).toBeGreaterThan(10500);
    expect(easyFinalBurst?.atMs).toBeLessThan(pattern.durationMs);

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.information.notification_overflow"),
      seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
    });
    const projectile = () => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === "packet-rain"
        && entry.burstIndex === 0
        && entry.sourceIndex === 0);
      expect(candidate).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
    };
    stepTo(68);
    expect(projectile()).toMatchObject({
      state: "arm",
      spawnedAtTick: 68,
      armAtTick: 73,
      position: {x: 26.933333333333334, y: 12.8},
      speedPxPerSecond: 112,
      collisionEnabled: false,
    });
    stepTo(73);
    expect(projectile()).toMatchObject({
      state: "flight",
      position: {x: 26.933333333333334, y: 12.8},
      speedPxPerSecond: 112,
      collisionEnabled: true,
    });

    const motionStartMs = 73 * 1000 / 120;
    const authoredSpawnMs = 566;
    const speedIntegral = (toMs: number): number => {
      const integrateRise = (fromMs: number, endMs: number): number => {
        const fromAge = fromMs - authoredSpawnMs;
        const endAge = endMs - authoredSpawnMs;
        return 112 * (endAge - fromAge) / 1000
          + 42 * (endAge ** 2 - fromAge ** 2) / (2 * 1600 * 1000);
      };
      const speedKeyMs = authoredSpawnMs + 1600;
      if (toMs <= speedKeyMs) return integrateRise(motionStartMs, toMs);
      return integrateRise(motionStartMs, speedKeyMs) + 154 * (toMs - speedKeyMs) / 1000;
    };
    const biasedSeconds = (tick120: number): number => {
      let total = 0;
      for (let movementTick120 = 74; movementTick120 <= tick120; movementTick120 += 1) {
        const sampleMs = movementTick120 * 1000 / 120;
        total += (1 + 0.45 * Math.sin(Math.PI * 2 * sampleMs / 1800)) / 120;
      }
      return total;
    };
    const expectedPosition = (tick120: number) => {
      const toMs = tick120 * 1000 / 120;
      const linear = speedIntegral(toMs);
      const field = biasedSeconds(tick120);
      return {
        x: 26.933333333333334
          + Math.cos(Math.PI / 2) * linear
          + 11 * (toMs - motionStartMs) / 1000
          + 12 * field,
        y: 12.8 + Math.sin(Math.PI / 2) * linear + 18 * field,
        speed: toMs - authoredSpawnMs >= 1600
          ? 154
          : 112 + 42 * (toMs - authoredSpawnMs) / 1600,
      };
    };
    for (const tick120 of [74, 108, 216, 259, 260] as const) {
      stepTo(tick120);
      const expectedAtTick = expectedPosition(tick120);
      expect(projectile().position.x).toBeCloseTo(expectedAtTick.x, 11);
      expect(projectile().position.y).toBeCloseTo(expectedAtTick.y, 11);
      expect(projectile().speedPxPerSecond).toBeCloseTo(expectedAtTick.speed, 11);
    }
  });

  it("keeps Notification Overflow pulse phase relative to a nonzero occurrence start", () => {
    const patternId = "room.information.notification_overflow" as const;
    const startOffsetTick120 = 401;
    const relativeTargetTick120 = 260;
    const atZero = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
    });
    const atOffset = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
      startTick120: startOffsetTick120,
    });
    for (let relativeTick120 = 1;
      relativeTick120 <= relativeTargetTick120;
      relativeTick120 += 1) {
      const sample = {movement: {x: 0, y: 0}, focused: false} as const;
      atZero.step({tick120: relativeTick120, ...sample});
      atOffset.step({tick120: startOffsetTick120 + relativeTick120, ...sample});
    }

    const relativeProjectiles = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - startTick120,
        spawnedAtTick: projectile.spawnedAtTick - startTick120,
        armAtTick: projectile.armAtTick - startTick120,
      }));
    expect(relativeProjectiles(atOffset, startOffsetTick120)).toEqual(
      relativeProjectiles(atZero, 0),
    );

    const relativeMilliseconds = (value: number, startTick120: number): number =>
      Math.round((value - startTick120 * 1000 / 120) * 1_000_000_000) / 1_000_000_000;
    const relativeEvents = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        if (typeof payload.readyAtMs === "number") {
          payload.readyAtMs = relativeMilliseconds(payload.readyAtMs, startTick120);
        }
        return {
          ...event,
          tick120: event.tick120 - startTick120,
          simulationTimeMs: relativeMilliseconds(event.simulationTimeMs, startTick120),
          payload,
        };
      });
    expect(relativeEvents(atOffset, startOffsetTick120)).toEqual(relativeEvents(atZero, 0));
  });

  it("omits Notification Overflow lanes before RNG and preflights the same field across E/N/H", {
    timeout: 10000,
  }, () => {
    const pattern = executablePattern("room.information.notification_overflow");
    const expected = {
      EASY: {candidates: 180, lane: 0, rng: 180, preflight: 28, spawn: 152, outOfBounds: 75, patternEnd: 77},
      NORMAL: {candidates: 240, lane: 16, rng: 224, preflight: 39, spawn: 185, outOfBounds: 106, patternEnd: 79},
      HARD: {candidates: 288, lane: 32, rng: 256, preflight: 46, spawn: 210, outOfBounds: 148, patternEnd: 62},
    } as const;
    const expectedOpeningSourceIndices = {
      EASY: [],
      NORMAL: [7],
      HARD: [8, 9],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.information.notification_overflow"),
        seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
        difficulty,
      });
      const schedule = createPatternSchedule(pattern, difficulty);
      let candidates = 0;
      let laneOmissions = 0;
      const firstOpeningSourceIndices: number[] = [];
      for (const scheduled of schedule) {
        const count = roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        );
        candidates += count;
        const lateral = scheduled.emitter.motionStack.find((entry) =>
          entry.operator === "op.lateral_wall");
        expect(lateral).toBeDefined();
        const laneCount = lateral?.params.laneCount as number;
        const openLane = lateral?.params.openLane as number;
        for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
          const lane = Math.min(
            laneCount - 1,
            Math.floor((sourceIndex + 0.5) * laneCount / count),
          );
          if (lane === openLane) {
            laneOmissions += 1;
            if (scheduled.burstIndex === 0) firstOpeningSourceIndices.push(sourceIndex);
          }
        }
      }
      expect(firstOpeningSourceIndices).toEqual(expectedOpeningSourceIndices[difficulty]);

      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, snapshot.relativeTick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }
      const events = kernel.events();
      const spawnCommits = events.filter((event) => event.id === "projectile.spawn.commit").length;
      const countCancellation = (reason: string): number => events.filter((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === reason).length;
      expect({
        candidates,
        lane: laneOmissions,
        rng: kernel.snapshot().rngCallsConsumed,
        preflight: kernel.snapshot().rngCallsConsumed - spawnCommits,
        spawn: spawnCommits,
        outOfBounds: countCancellation("out_of_bounds"),
        patternEnd: countCancellation("pattern_end"),
      }).toEqual(expected[difficulty]);
      expect(candidates - laneOmissions).toBe(kernel.snapshot().rngCallsConsumed);
      expect(countCancellation("out_of_bounds") + countCancellation("pattern_end"))
        .toBe(spawnCommits);
      expect(countCancellation("source_withdrawn")).toBe(0);
      expect(events.filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
      expect(events.filter((event) => event.id === "player.damage.commit")).toEqual([]);
      expect(kernel.projectilePoolAudit()).toEqual([]);
    }
  });

  it("is render-cadence invariant through Notification Overflow curve and pulse phases", () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveNotificationOverflowWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
    );
    const at144Hz = driveNotificationOverflowWithDeltas(
      Array.from({length: 504}, () => 1000 / 144),
      targetTick120,
    );
    const retainedBacklog = driveNotificationOverflowWithDeltas([durationMs], targetTick120);
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(retainedBacklog.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(retainedBacklog.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("ends Notification Overflow at 1344 and drains 291 ticks of packet dust at 1635", () => {
    const pattern = executablePattern("room.information.notification_overflow");
    expect(crossedTickCount(pattern.durationMs)).toBe(1344);
    expect(crossedTickCount(2425)).toBe(291);
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.information.notification_overflow"),
      seed: NOTIFICATION_OVERFLOW_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 1344; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1344,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
      poolUsage: {liveColliders: 0},
    });
    expect(kernel.snapshot().projectiles.length).toBeGreaterThanOrEqual(79);
    expect(kernel.snapshot().projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(kernel.events().filter((event) =>
      event.tick120 === 1344
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toHaveLength(79);

    for (let tick120 = 1345; tick120 <= 1634; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1634,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles).toHaveLength(79);
    kernel.step(safeGapFollowingInput(kernel, pattern, 1635));
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1635,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(kernel.events().filter((event) =>
      event.tick120 === 1635 && event.id === "projectile.residue.remove")).toHaveLength(79);
  });

  it("pins Rain Packets as a weather-isolated grid with exact V4 oracle evidence", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.rain_packets"),
      seed: RAIN_PACKETS_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract).toMatchObject({
      id: "encounter.weather_echo.rain_packets",
      category: "WEATHER_ECHO",
      room: "COMMON",
      durationMs: 9400,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 742, event: "collision.arm"},
        {atMs: 742, event: "emit.begin"},
        {atMs: 4700, event: "pattern.midpoint"},
        {atMs: 8700, event: "emit.end"},
        {atMs: 8980, event: "residue.commit"},
        {atMs: 9400, event: "pattern.complete"},
      ],
      warning: {
        durationMs: 742,
        shape: "rainfall_projection",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      safeGap: {
        type: "rain_lee",
        minimumWidthPx: 38,
        focusMinimumWidthPx: 30,
        enforcement: "lane_omission",
        path: {
          centerX: 180,
          amplitudePx: 46,
          periodMs: 8200,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        readability: {leadMs: 520, neverColorOnly: true},
      },
      residue: {
        type: "wet_packet_pulp",
        lifetimeMs: 3793,
        density: 0.21,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      seed: {
        base: 1771200059,
        disallowedInputs: ["weatherEvent", "weatherSeed", "weatherRng"],
      },
      weatherEchoContract: {
        visualSource: "RAIN",
        schedulingAuthority: "director.encounter.v4",
        runsParallelToWeather: true,
        weatherEventCanTrigger: false,
        weatherEventCanSpawnProjectile: false,
        weatherEventCanAlterMotion: false,
        weatherEventCanAlterCollision: false,
        weatherEventCanAlterSafeGap: false,
        weatherRngUsed: false,
        seedAuthority: "pattern.seed only",
      },
      emitters: [expect.objectContaining({
        id: "rain",
        kind: "projectile",
        anchor: {space: "viewport-normalized", x: 0.5, y: 0},
        geometry: {
          type: "grid",
          variant: "uneven-droplets",
          count: 13,
          baseAngleDeg: 90,
          spreadDeg: 0,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 742, intervalMs: 540, bursts: 15, intraBurstMs: 0},
        projectile: {archetype: "bullet.micro.dash", collisionRadiusPx: 2, armDelayMs: 40},
        speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 126}]},
        motionStack: [
          {
            operator: "op.local_vector_bias",
            params: {vectorPxPerSec: [8, 30], pulsePeriodMs: 2100, pulseAmount: 0.35},
          },
          {operator: "op.linear", params: {}},
        ],
      })],
    });
    expect("laserGeometry" in contract).toBe(false);
    expect(kernel.snapshot().adapterGaps.rainLaneOmission).toEqual({
      order: "geometry-source-index>rng-jitter>swept-preflight>entity-spawn",
      preflight: "shared-fixed-tick-local-vector-corridor-sweep",
      spawnIdentity: "assigned-only-after-preflight-pass",
      residue: "omitted-candidates-have-no-entity-or-residue",
    });
    expect("weatherEvent" in kernel.snapshot().adapterGaps).toBe(false);
    expect("weatherSeed" in kernel.snapshot().adapterGaps).toBe(false);
    expect("weatherRng" in kernel.snapshot().adapterGaps).toBe(false);

    const expected = {
      EASY: {
        emissions: 14,
        candidates: 140,
        interventions: 20,
        hash: "6667fc66a702c25d1fbb56d8d3ba55d307695ce6b70c934b81c40b4b047776eb",
      },
      NORMAL: {
        emissions: 15,
        candidates: 195,
        interventions: 28,
        hash: "68480085b6a1542700ad86eceb4e37aaede7e3a23b8854de82d61f64e7bdbbc2",
      },
      HARD: {
        emissions: 15,
        candidates: 225,
        interventions: 35,
        hash: "aa8c029c73588e4488e93b1d02adf7f5c7ce6ab7334c0ed6d2527a23b16832f2",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: RAIN_PACKETS_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: RAIN_PACKETS_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      const projection = (trace: typeof reference) => ({
        emissions: trace.events.length,
        candidates: trace.events.reduce((total, event) => total + event.count, 0),
        interventions: trace.omittedOrRedirected,
        splitChildren: trace.splitChildren,
        hash: trace.traceSha256,
      });
      expect(projection(reference)).toEqual({...expected[difficulty], splitChildren: 0});
      expect(projection(declared)).toEqual({...expected[difficulty], splitChildren: 0});
      expect(declared.traceSha256).toBe(reference.traceSha256);
    }
  });

  it("fails closed on hostile Rain Packets source shape and weather inputs", () => {
    const source = structuredClone(
      executablePattern("encounter.weather_echo.rain_packets"),
    ) as unknown as {
      safeGap: {enforcement: string};
      seed: {disallowedInputs: string[]};
      weatherEchoContract: {weatherEventCanAlterSafeGap: boolean};
      emitters: Array<{
        geometry: {variant: string};
        motionStack: Array<{operator: string; params: Record<string, unknown>}>;
      }>;
      metadata?: string;
    };
    expect(() => validateRainPacketsWeatherEchoContract(source)).not.toThrow();
    expect(() => validateRainPacketsWeatherEchoContract({...source, metadata: "write-back"}))
      .toThrow(/contract|keys/);
    const gapDrift = structuredClone(source);
    gapDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateRainPacketsWeatherEchoContract(gapDrift)).toThrow(/authored weather-echo/);
    const weatherDrift = structuredClone(source);
    weatherDrift.weatherEchoContract.weatherEventCanAlterSafeGap = true;
    expect(() => validateRainPacketsWeatherEchoContract(weatherDrift)).toThrow(/authored weather-echo/);
    const seedDrift = structuredClone(source);
    seedDrift.seed.disallowedInputs.reverse();
    expect(() => validateRainPacketsWeatherEchoContract(seedDrift)).toThrow(/authored weather-echo/);
    const geometryDrift = structuredClone(source);
    geometryDrift.emitters[0]!.geometry.variant = "generic-grid";
    expect(() => validateRainPacketsWeatherEchoContract(geometryDrift)).toThrow(/rain emitter/);
    const orderDrift = structuredClone(source);
    orderDrift.emitters[0]!.motionStack.reverse();
    expect(() => validateRainPacketsWeatherEchoContract(orderDrift)).toThrow(/declaration order/);
    const vectorDrift = structuredClone(source);
    vectorDrift.emitters[0]!.motionStack[0]!.params.weatherRng = true;
    expect(() => validateRainPacketsWeatherEchoContract(vectorDrift)).toThrow(/contract|keys/);

    let weatherReads = 0;
    const accessorWeather = Object.defineProperty(
      structuredClone(source),
      "weatherEchoContract",
      {
        enumerable: true,
        get() {
          weatherReads += 1;
          return source.weatherEchoContract;
        },
      },
    );
    expect(() => validateRainPacketsWeatherEchoContract(accessorWeather)).toThrow(/own data property/);
    expect(weatherReads).toBe(0);
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.rain_packets"),
      projectilePoolClasses: {"bullet.micro.dash": "medium"},
    })).toThrow(/pool mapping disagrees|pool-class mapping|micro pool class/i);
  });

  it("keeps Rain Packets cadence, arm crossings, and endpoint-sampled local field exact", () => {
    const pattern = executablePattern("encounter.weather_echo.rain_packets");
    const expected = {
      EASY: {
        count: 10,
        spawn: [90, 165, 240, 315, 390, 465, 541, 616, 691, 766, 841, 916, 992, 1067],
        arm: [94, 170, 245, 320, 395, 470, 545, 621, 696, 771, 846, 921, 996, 1072],
      },
      NORMAL: {
        count: 13,
        spawn: [90, 154, 219, 284, 349, 414, 478, 543, 608, 673, 738, 802, 867, 932, 997],
        arm: [94, 159, 224, 289, 354, 418, 483, 548, 613, 678, 742, 807, 872, 937, 1002],
      },
      HARD: {
        count: 15,
        spawn: [90, 147, 204, 261, 318, 375, 432, 489, 546, 603, 660, 717, 774, 831, 888],
        arm: [94, 151, 208, 265, 322, 379, 436, 494, 551, 608, 665, 722, 779, 836, 893],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(roundPatternCount(
        pattern.emitters[0]!.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      )).toBe(expected[difficulty].count);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(expected[difficulty].spawn);
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expected[difficulty].arm);
    }
    const easySchedule = createPatternSchedule(pattern, "EASY");
    const easyFinalBurst = easySchedule[easySchedule.length - 1];
    expect(easyFinalBurst?.atMs).toBeCloseTo(8885.2, 10);
    expect(easyFinalBurst?.atMs).toBeGreaterThan(8700);
    expect(easyFinalBurst?.atMs).toBeLessThan(pattern.durationMs);
    expect(crossedTickCount(easyFinalBurst?.atMs ?? Number.NaN)).toBe(1067);
    // Cadence is the spawn authority. The authored emit.end timeline cue cannot
    // silently truncate a difficulty-scaled burst that still precedes duration.
    expect(easySchedule.filter((entry) => entry.atMs > 8700)).toHaveLength(1);

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.rain_packets"),
      seed: RAIN_PACKETS_REPORT_SEED,
    });
    const projectile = () => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === "rain" && entry.burstIndex === 0 && entry.sourceIndex === 0);
      expect(candidate).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    stepTo(90);
    expect(kernel.snapshot().rngCallsConsumed).toBe(13);
    expect(kernel.snapshot().projectiles.map((entry) => entry.sourceIndex))
      .toEqual([0, 1, 2, 7, 8, 9, 10, 11, 12]);
    expect(kernel.snapshot().projectiles.map((entry) => entry.instanceId)).toEqual(
      Array.from({length: 9}, (_, index) =>
        `combat:encounter.weather_echo.rain_packets/micro/${String(index).padStart(4, "0")}`),
    );
    expect(kernel.events().filter((event) => event.id.includes("residue"))).toEqual([]);
    expect(projectile()).toMatchObject({
      state: "arm",
      spawnedAtTick: 90,
      armAtTick: 94,
      position: {x: 28.615384615384617, y: 0},
      speedPxPerSecond: 126,
      collisionEnabled: false,
    });
    stepTo(94);
    expect(projectile()).toMatchObject({state: "flight", collisionEnabled: true});
    const biasedSeconds = (tick120: number): number => {
      let total = 0;
      for (let movementTick120 = 95; movementTick120 <= tick120; movementTick120 += 1) {
        const relativeMs = movementTick120 * 1000 / 120;
        total += (1 + 0.35 * Math.sin(Math.PI * 2 * relativeMs / 2100)) / 120;
      }
      return total;
    };
    const expectedPosition = (tick120: number) => ({
      x: 28.615384615384617 + 8 * biasedSeconds(tick120),
      y: 126 * (tick120 - 94) / 120 + 30 * biasedSeconds(tick120),
    });
    for (const tick120 of [95, 120, 160, 200] as const) {
      stepTo(tick120);
      expect(projectile().position.x).toBeCloseTo(expectedPosition(tick120).x, 11);
      expect(projectile().position.y).toBeCloseTo(expectedPosition(tick120).y, 11);
      expect(projectile().speedPxPerSecond).toBe(126);
    }
  });

  it("retains an admitted Rain collider through graze and one nonfatal swept impact", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.rain_packets"),
      seed: RAIN_PACKETS_REPORT_SEED,
      initialPlayerPosition: {x: 56.79370812567784, y: 570},
    });
    for (let tick120 = 1; tick120 <= 532; tick120 += 1) {
      kernel.step({tick120, movement: {x: 0, y: 0}, focused: false});
    }
    const projectileId = "combat:encounter.weather_echo.rain_packets/micro/0000";
    expect(kernel.events().filter((event) =>
      event.tick120 === 522 && event.id === "projectile.graze.commit"))
      .toEqual([expect.objectContaining({
        payload: expect.objectContaining({
          evidence: 1,
          playerId: "player",
          projectileGeneration: 0,
          projectileId,
        }),
      })]);
    expect(kernel.snapshot().evidence.amount).toBe(1);
    expect(kernel.snapshot().player.health).toBe(3);
    expect(kernel.snapshot().projectiles.find((entry) => entry.instanceId === projectileId))
      .toMatchObject({state: "flight", collisionEnabled: true, sourceId: "rain", sourceIndex: 0});

    kernel.step({tick120: 533, movement: {x: 0, y: 0}, focused: false});
    expect(kernel.snapshot().lastDamageBatch).toMatchObject({
      tick120: 533,
      committedSourceId: `${projectileId}:0`,
      branch: "non-fatal",
      hits: [{sourceId: `${projectileId}:0`, amount: 1, disposition: "committed"}],
    });
    expect(kernel.snapshot().player).toMatchObject({
      state: "alive",
      health: 2,
      collisionEnabled: false,
      recoveryAtTick120: 654,
    });
    expect(kernel.snapshot().projectiles.find((entry) => entry.instanceId === projectileId))
      .toMatchObject({
        state: "residue",
        collisionEnabled: false,
        terminalCause: "impact",
        movedAtTick120: 533,
      });
    expect(kernel.events().filter((event) => event.tick120 === 533).map((event) => event.id))
      .toEqual([
        "projectile.collision.off",
        "player.collision.off",
        "projectile.impact.commit",
        "projectile.residue.begin",
        "player.damage.commit",
        "player.invulnerability.begin",
      ]);
  });

  it("preflights Rain after RNG but before identity and drains only spawned residue across E/N/H", {
    timeout: 20000,
  }, () => {
    const pattern = executablePattern("encounter.weather_echo.rain_packets");
    const completeTick120 = crossedTickCount(pattern.durationMs);
    const residueTicks = crossedTickCount(3793);
    expect(completeTick120).toBe(1128);
    expect(residueTicks).toBe(456);
    const expected = {
      EASY: {
        candidates: 140,
        rng: 140,
        preflight: 21,
        spawn: 119,
        outOfBounds: 46,
        patternEnd: 73,
        atCompleteProjectiles: 119,
        productionHash: "869d1ee119a4a772698c27a769386cf02fcca1a06b09521e085e1b2f306a308d",
      },
      NORMAL: {
        candidates: 195,
        rng: 195,
        preflight: 29,
        spawn: 166,
        outOfBounds: 71,
        patternEnd: 95,
        atCompleteProjectiles: 166,
        productionHash: "afd1dde61a6bc1b076571813e2b065bed8ca536b2d8d947e43cf66f0ff8038c7",
      },
      HARD: {
        candidates: 225,
        rng: 225,
        preflight: 39,
        spawn: 186,
        outOfBounds: 107,
        patternEnd: 79,
        atCompleteProjectiles: 174,
        productionHash: "1829f3539e67f76b8013d73ef10242369f59909d58b7f1b439772db013aca8d9",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("encounter.weather_echo.rain_packets"),
        seed: RAIN_PACKETS_REPORT_SEED,
        difficulty,
      });
      const candidates = createPatternSchedule(pattern, difficulty).reduce((total, scheduled) =>
        total + roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        ), 0);
      for (let tick120 = 1; tick120 <= completeTick120; tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, snapshot.relativeTick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }
      const eventsAtComplete = kernel.events();
      const spawnCommits = eventsAtComplete.filter((event) =>
        event.id === "projectile.spawn.commit").length;
      const countCancellation = (reason: string): number => eventsAtComplete.filter((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === reason).length;
      expect({
        candidates,
        rng: kernel.snapshot().rngCallsConsumed,
        preflight: kernel.snapshot().rngCallsConsumed - spawnCommits,
        spawn: spawnCommits,
        outOfBounds: countCancellation("out_of_bounds"),
        patternEnd: countCancellation("pattern_end"),
        atCompleteProjectiles: kernel.snapshot().projectiles.length,
        productionHash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual(expected[difficulty]);
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1128,
        patternComplete: true,
        digitalBodiesDrained: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
        poolUsage: {liveColliders: 0},
      });
      expect(kernel.snapshot().projectiles.every((projectile) =>
        projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
      expect(countCancellation("source_withdrawn")).toBe(0);
      expect(eventsAtComplete.filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
      expect(eventsAtComplete.filter((event) => event.id === "player.damage.commit")).toEqual([]);
      expect(eventsAtComplete.filter((event) => event.id === "projectile.residue.begin"))
        .toHaveLength(expected[difficulty].spawn);
      expect(kernel.projectilePoolAudit()).toEqual([]);

      for (let tick120 = 1129; tick120 <= 1583; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1583,
        patternComplete: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
      });
      expect(kernel.snapshot().projectiles).toHaveLength(expected[difficulty].patternEnd);
      kernel.step(safeGapFollowingInput(kernel, pattern, 1584));
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1584,
        patternComplete: true,
        projectileLifecycleDrained: true,
        handoffReady: true,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
      });
      const finalEvents = kernel.events();
      expect(finalEvents.filter((event) =>
        event.tick120 === 1584 && event.id === "projectile.residue.remove"))
        .toHaveLength(expected[difficulty].patternEnd);
      expect(finalEvents.filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(expected[difficulty].spawn);
      expect(finalEvents.filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(expected[difficulty].spawn);
    }
  });

  it("keeps Rain field phase, identity, and events relative to a nonzero occurrence start", () => {
    const patternId = "encounter.weather_echo.rain_packets" as const;
    const startOffsetTick120 = 401;
    const relativeTargetTick120 = 220;
    const atZero = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: RAIN_PACKETS_REPORT_SEED,
    });
    const atOffset = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: RAIN_PACKETS_REPORT_SEED,
      startTick120: startOffsetTick120,
    });
    for (let relativeTick120 = 1;
      relativeTick120 <= relativeTargetTick120;
      relativeTick120 += 1) {
      const sample = {movement: {x: 0, y: 0}, focused: false} as const;
      atZero.step({tick120: relativeTick120, ...sample});
      atOffset.step({tick120: startOffsetTick120 + relativeTick120, ...sample});
    }
    const relativeProjectiles = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - startTick120,
        spawnedAtTick: projectile.spawnedAtTick - startTick120,
        armAtTick: projectile.armAtTick - startTick120,
      }));
    expect(relativeProjectiles(atOffset, startOffsetTick120))
      .toEqual(relativeProjectiles(atZero, 0));
    const relativeMilliseconds = (value: number, startTick120: number): number =>
      Math.round((value - startTick120 * 1000 / 120) * 1_000_000_000) / 1_000_000_000;
    const relativeEvents = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        if (typeof payload.readyAtMs === "number") {
          payload.readyAtMs = relativeMilliseconds(payload.readyAtMs, startTick120);
        }
        return {
          ...event,
          tick120: event.tick120 - startTick120,
          simulationTimeMs: relativeMilliseconds(event.simulationTimeMs, startTick120),
          payload,
        };
      });
    expect(relativeEvents(atOffset, startOffsetTick120)).toEqual(relativeEvents(atZero, 0));
  });

  it("keeps Rain identical across rooms, accessibility/weather profiles, cadences, and backlog", () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveRainPacketsWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
      "INFORMATION",
      {weatherEvent: "RAIN", reducedMotion: false, flashOff: false},
    );
    const at144Hz = driveRainPacketsWithDeltas(
      Array.from({length: 504}, () => 1000 / 144),
      targetTick120,
      "FORCED_ALIGNMENT",
      {weatherEvent: "WIND", reducedMotion: true, flashOff: true},
    );
    const retainedBacklog = driveRainPacketsWithDeltas(
      [durationMs],
      targetTick120,
      "IN_BETWEEN",
      {weatherEvent: "ASH", reducedMotion: false, flashOff: true},
    );
    const polarized = driveRainPacketsWithDeltas(
      Array.from({length: 210}, () => 1000 / 60),
      targetTick120,
      "POLARIZED",
      {weatherEvent: "CLEAR", reducedMotion: true, flashOff: false},
    );
    for (const candidate of [at144Hz, retainedBacklog, polarized]) {
      expect(candidate.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(at30Hz.snapshot());
    }
  });

  it("pins Wind Bias as a weather-isolated arc field with layered V4 QA evidence", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.wind_bias"),
      seed: WIND_BIAS_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract).toMatchObject({
      id: "encounter.weather_echo.wind_bias",
      category: "WEATHER_ECHO",
      room: "COMMON",
      durationMs: 9600,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 578, event: "collision.arm"},
        {atMs: 578, event: "emit.begin"},
        {atMs: 4800, event: "pattern.midpoint"},
        {atMs: 8900, event: "emit.end"},
        {atMs: 9180, event: "residue.commit"},
        {atMs: 9600, event: "pattern.complete"},
      ],
      warning: {
        durationMs: 578,
        shape: "maximum_advection_envelope",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      safeGap: {
        type: "wind_lee",
        minimumWidthPx: 36,
        focusMinimumWidthPx: 28,
        enforcement: "spawn_omission",
        path: {
          centerX: 180,
          amplitudePx: 70,
          periodMs: 8800,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        readability: {leadMs: 520, neverColorOnly: true},
      },
      residue: {
        type: "wind_polished_grain",
        lifetimeMs: 3143,
        density: 0.44,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      seed: {
        base: 1709396168,
        disallowedInputs: ["weatherEvent", "weatherSeed", "weatherRng"],
      },
      weatherEchoContract: {
        visualSource: "WIND",
        schedulingAuthority: "director.encounter.v4",
        runsParallelToWeather: true,
        weatherEventCanTrigger: false,
        weatherEventCanSpawnProjectile: false,
        weatherEventCanAlterMotion: false,
        weatherEventCanAlterCollision: false,
        weatherEventCanAlterSafeGap: false,
        weatherRngUsed: false,
        seedAuthority: "pattern.seed only",
      },
      emitters: [expect.objectContaining({
        id: "wind-seeds",
        kind: "projectile",
        anchor: {space: "viewport-normalized", x: 0.42, y: 0.12},
        geometry: {
          type: "arc",
          variant: "advected-seeds",
          count: 10,
          baseAngleDeg: 90,
          spreadDeg: 134,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 578, intervalMs: 920, bursts: 9, intraBurstMs: 0},
        projectile: {archetype: "bullet.micro.seed", collisionRadiusPx: 2, armDelayMs: 40},
        speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 144}]},
        motionStack: [
          {
            operator: "op.local_vector_bias",
            params: {vectorPxPerSec: [34, 4], pulsePeriodMs: 1600, pulseAmount: 0.6},
          },
          {operator: "op.linear", params: {}},
        ],
      })],
    });
    expect("laserGeometry" in contract).toBe(false);
    expect(Object.isFrozen(
      (contract as unknown as {seed: {disallowedInputs: readonly string[]}})
        .seed.disallowedInputs,
    )).toBe(true);

    const expected = {
      EASY: {
        emissions: 9,
        candidates: 72,
        interventions: 3,
        hash: "a08967082126112d23763302b1e83ca9b31c008a1a42cf31be80ef3a43fc7fd1",
      },
      NORMAL: {
        emissions: 9,
        candidates: 90,
        interventions: 4,
        hash: "f71f171fd5d61e01cc11d9b4ff4b4610ad9fbce02ceab035fcf5e1965efe8d72",
      },
      HARD: {
        emissions: 9,
        candidates: 108,
        interventions: 7,
        hash: "92a38086e744944ce814da54e36febf78cbd01a274addfe9bbb91552db45c012",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: WIND_BIAS_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: WIND_BIAS_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      const projection = (trace: typeof reference) => ({
        emissions: trace.events.length,
        candidates: trace.events.reduce((total, event) => total + event.count, 0),
        interventions: trace.omittedOrRedirected,
        splitChildren: trace.splitChildren,
        hash: trace.traceSha256,
      });
      expect(projection(reference)).toEqual({...expected[difficulty], splitChildren: 0});
      expect(projection(declared)).toEqual({...expected[difficulty], splitChildren: 0});
      expect(declared.traceSha256).toBe(reference.traceSha256);
    }
  });

  it("rejects non-micro Wind Bias pool mappings and exposes no weather authority input", () => {
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.wind_bias"),
      projectilePoolClasses: {"bullet.micro.seed": "medium"},
    })).toThrow(/pool mapping disagrees|pool-class mapping|micro pool class/i);
    const kernel = new CanonicalCombatKernel(optionsFor("encounter.weather_echo.wind_bias"));
    expect(Object.keys(kernel.adapterGaps).sort()).toEqual([
      "grazeRadiusPx",
      "lateralWallLaneProjection",
      "positiveAimLeadPolicy",
      "projectileDamage",
      "projectilePoolClasses",
      "provenance",
      "targetHistorySampling",
    ]);
    expect(kernel.adapterGaps.projectilePoolClasses).toEqual({"bullet.micro.seed": "micro"});
    expect("weatherEvent" in kernel.adapterGaps).toBe(false);
    expect("weatherSeed" in kernel.adapterGaps).toBe(false);
    expect("weatherRng" in kernel.adapterGaps).toBe(false);
  });

  it("keeps exact Wind Bias cadence, arm delay, and fixed-tick field motion", () => {
    const pattern = executablePattern("encounter.weather_echo.wind_bias");
    const expected = {
      EASY: {
        spawn: [70, 198, 326, 454, 582, 710, 838, 966, 1094],
        arm: [75, 203, 331, 459, 587, 715, 843, 971, 1099],
      },
      NORMAL: {
        spawn: [70, 180, 291, 401, 511, 622, 732, 843, 953],
        arm: [75, 185, 295, 406, 516, 627, 737, 847, 958],
      },
      HARD: {
        spawn: [70, 167, 264, 361, 458, 556, 653, 750, 847],
        arm: [75, 172, 269, 366, 463, 560, 658, 755, 852],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(
        expected[difficulty].spawn,
      );
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expected[difficulty].arm);
    }

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.wind_bias"),
      seed: WIND_BIAS_REPORT_SEED,
    });
    const projectile = () => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === "wind-seeds"
        && entry.burstIndex === 0
        && entry.sourceIndex === 0);
      expect(candidate).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    stepTo(70);
    expect(projectile()).toMatchObject({
      state: "arm",
      spawnedAtTick: 70,
      armAtTick: 75,
      position: {x: 151.2, y: 76.8},
      speedPxPerSecond: 144,
      collisionEnabled: false,
    });
    const headingDegrees = projectile().headingDegrees;
    stepTo(75);
    expect(projectile()).toMatchObject({
      state: "flight",
      position: {x: 151.2, y: 76.8},
      speedPxPerSecond: 144,
      collisionEnabled: true,
    });

    const biasedSeconds = (tick120: number): number => {
      let total = 0;
      for (let movementTick120 = 76; movementTick120 <= tick120; movementTick120 += 1) {
        const relativeMs = movementTick120 * 1000 / 120;
        total += (1 + 0.6 * Math.sin(Math.PI * 2 * relativeMs / 1600)) / 120;
      }
      return total;
    };
    const expectedPosition = (tick120: number) => {
      const linearSeconds = (tick120 - 75) / 120;
      const fieldSeconds = biasedSeconds(tick120);
      const radians = headingDegrees * Math.PI / 180;
      return {
        x: 151.2 + Math.cos(radians) * 144 * linearSeconds + 34 * fieldSeconds,
        y: 76.8 + Math.sin(radians) * 144 * linearSeconds + 4 * fieldSeconds,
      };
    };
    for (const tick120 of [76, 120, 160, 200] as const) {
      stepTo(tick120);
      expect(projectile().position.x).toBeCloseTo(expectedPosition(tick120).x, 11);
      expect(projectile().position.y).toBeCloseTo(expectedPosition(tick120).y, 11);
      expect(projectile().speedPxPerSecond).toBe(144);
    }
  });

  it("keeps Wind Bias field phase and events relative to a nonzero occurrence start", () => {
    const patternId = "encounter.weather_echo.wind_bias" as const;
    const startOffsetTick120 = 401;
    const relativeTargetTick120 = 220;
    const atZero = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: WIND_BIAS_REPORT_SEED,
    });
    const atOffset = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: WIND_BIAS_REPORT_SEED,
      startTick120: startOffsetTick120,
    });
    for (let relativeTick120 = 1;
      relativeTick120 <= relativeTargetTick120;
      relativeTick120 += 1) {
      const sample = {movement: {x: 0, y: 0}, focused: false} as const;
      atZero.step({tick120: relativeTick120, ...sample});
      atOffset.step({tick120: startOffsetTick120 + relativeTick120, ...sample});
    }
    const relativeProjectiles = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - startTick120,
        spawnedAtTick: projectile.spawnedAtTick - startTick120,
        armAtTick: projectile.armAtTick - startTick120,
      }));
    expect(relativeProjectiles(atOffset, startOffsetTick120)).toEqual(
      relativeProjectiles(atZero, 0),
    );
    const relativeMilliseconds = (value: number, startTick120: number): number =>
      Math.round((value - startTick120 * 1000 / 120) * 1_000_000_000) / 1_000_000_000;
    const relativeEvents = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        if (typeof payload.readyAtMs === "number") {
          payload.readyAtMs = relativeMilliseconds(payload.readyAtMs, startTick120);
        }
        return {
          ...event,
          tick120: event.tick120 - startTick120,
          simulationTimeMs: relativeMilliseconds(event.simulationTimeMs, startTick120),
          payload,
        };
      });
    expect(relativeEvents(atOffset, startOffsetTick120)).toEqual(relativeEvents(atZero, 0));
  });

  it("preflights Wind Bias with the runtime field and contact sweep across E/N/H", {
    timeout: 10000,
  }, () => {
    const pattern = executablePattern("encounter.weather_echo.wind_bias");
    const expected = {
      EASY: {
        candidates: 72,
        rng: 72,
        preflight: 3,
        spawn: 69,
        outOfBounds: 41,
        patternEnd: 28,
        productionHash: "20ef8b0405aca18abe447409d3452d3ea22bcd29d045f034abbd9691b9545f19",
      },
      NORMAL: {
        candidates: 90,
        rng: 90,
        preflight: 4,
        spawn: 86,
        outOfBounds: 62,
        patternEnd: 24,
        productionHash: "c69bb312fa1da427f4980334369f98a7e8c86f39d3757cd00f4153cb896970c3",
      },
      HARD: {
        candidates: 108,
        rng: 108,
        preflight: 7,
        spawn: 101,
        outOfBounds: 85,
        patternEnd: 16,
        productionHash: "b36d107625c6c1f9f45792108cd6a21293304e708404f8e08200df35d158640b",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("encounter.weather_echo.wind_bias"),
        seed: WIND_BIAS_REPORT_SEED,
        difficulty,
      });
      const candidates = createPatternSchedule(pattern, difficulty).reduce((total, scheduled) =>
        total + roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        ), 0);
      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, snapshot.relativeTick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }
      const events = kernel.events();
      const spawnCommits = events.filter((event) => event.id === "projectile.spawn.commit").length;
      const countCancellation = (reason: string): number => events.filter((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === reason).length;
      expect({
        candidates,
        rng: kernel.snapshot().rngCallsConsumed,
        preflight: kernel.snapshot().rngCallsConsumed - spawnCommits,
        spawn: spawnCommits,
        outOfBounds: countCancellation("out_of_bounds"),
        patternEnd: countCancellation("pattern_end"),
        productionHash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual(expected[difficulty]);
      expect(countCancellation("source_withdrawn")).toBe(0);
      expect(events.filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
      expect(events.filter((event) => event.id === "player.damage.commit")).toEqual([]);
      expect(kernel.projectilePoolAudit()).toEqual([]);
    }
  });

  it("keeps Wind Bias identical across player rooms, render cadences, and presentation weather", () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveWindBiasWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
      "INFORMATION",
      {weatherEvent: "WIND", reducedMotion: false, flashOff: false},
    );
    const at144Hz = driveWindBiasWithDeltas(
      Array.from({length: 504}, () => 1000 / 144),
      targetTick120,
      "FORCED_ALIGNMENT",
      {weatherEvent: "RAIN", reducedMotion: true, flashOff: true},
    );
    const retainedBacklog = driveWindBiasWithDeltas(
      [durationMs],
      targetTick120,
      "IN_BETWEEN",
      {weatherEvent: "ASH", reducedMotion: false, flashOff: true},
    );
    const polarized = driveWindBiasWithDeltas(
      Array.from({length: 210}, () => 1000 / 60),
      targetTick120,
      "POLARIZED",
      {weatherEvent: "CLEAR", reducedMotion: true, flashOff: false},
    );
    for (const candidate of [at144Hz, retainedBacklog, polarized]) {
      expect(candidate.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(at30Hz.snapshot());
    }
  });

  it("ends Wind Bias at 1152 and drains 378 ticks of polished grain at 1530", () => {
    const pattern = executablePattern("encounter.weather_echo.wind_bias");
    expect(crossedTickCount(pattern.durationMs)).toBe(1152);
    expect(crossedTickCount(3143)).toBe(378);
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("encounter.weather_echo.wind_bias"),
      seed: WIND_BIAS_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 1152; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1152,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
      poolUsage: {liveColliders: 0},
    });
    expect(kernel.snapshot().projectiles).toHaveLength(57);
    expect(kernel.snapshot().projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(kernel.events().filter((event) =>
      event.tick120 === 1152
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toHaveLength(24);

    for (let tick120 = 1153; tick120 <= 1529; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1529,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles).toHaveLength(24);
    kernel.step(safeGapFollowingInput(kernel, pattern, 1530));
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1530,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(kernel.events().filter((event) =>
      event.tick120 === 1530 && event.id === "projectile.residue.remove")).toHaveLength(24);
  });

  it("pins the Absent Receiver query phase, retry envelope, and compiler provenance", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.absent_receiver.phase1"),
      seed: ABSENT_RECEIVER_QUERY_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract).toMatchObject({
      id: "boss.absent_receiver.phase1",
      category: "BOSS",
      room: "INFORMATION",
      durationMs: 10800,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 773, event: "collision.arm"},
        {atMs: 773, event: "emit.begin"},
        {atMs: 5400, event: "pattern.midpoint"},
        {atMs: 10100, event: "emit.end"},
        {atMs: 10380, event: "residue.commit"},
        {atMs: 10800, event: "pattern.complete"},
      ],
      warning: {
        durationMs: 773,
        shape: "outbound-retry_swept_union",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      safeGap: {
        type: "static_void",
        minimumWidthPx: 30,
        focusMinimumWidthPx: 22,
        enforcement: "spawn_omission",
        path: {
          centerX: 180,
          amplitudePx: 18,
          periodMs: 5200,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        readability: {leadMs: 520, neverColorOnly: true},
      },
      residue: {
        type: "absent_receiver_material_trace",
        lifetimeMs: 2391,
        density: 0.39,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      laserGeometry: "laser.broken_packet_polyline",
      resolutionHook: {
        type: "phase_evidence",
        canonicalBossId: "boss.absent_receiver",
        narrativeAlias: "absent_receiver",
        resolutionId: "RECEIVER_TIMED_OUT",
        condition: "absent_receiver.phaseEvidence>=1",
        terminalEvent: null,
      },
    });
    expect(contract.emitters).toEqual([expect.objectContaining({
      id: "absent_receiver-p1-primary",
      anchor: {space: "viewport-normalized", x: 0.34, y: 0.1},
      geometry: {
        type: "arc",
        variant: "outbound-retry",
        count: 7,
        baseAngleDeg: 82,
        spreadDeg: 72,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 773, intervalMs: 720, bursts: 12, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 142}]},
      motionStack: [
        {operator: "op.linear", params: {}},
        {
          operator: "op.speed_envelope",
          params: {
            keys: [
              {atMs: 0, multiplier: 1},
              {atMs: 760, multiplier: 0},
              {atMs: 1240, multiplier: 1.25},
            ],
            interpolation: "step",
          },
        },
      ],
    })]);

    const expected = {
      EASY: {
        candidates: 60,
        interventions: 9,
        hash: "15b0510c803449ef73076397dc2456da892106713590651c2e0087c55146199e",
      },
      NORMAL: {
        candidates: 84,
        interventions: 10,
        hash: "1d20801ad3c3cd807ed0c143a3b1735cac679beea3e457f82738f06378a46c42",
      },
      HARD: {
        candidates: 96,
        interventions: 3,
        hash: "94b04fee2420e57ee6ed9f1bd453e42fba4f8fa171a3ff37fa36cda90a24d771",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: ABSENT_RECEIVER_QUERY_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: ABSENT_RECEIVER_QUERY_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      for (const trace of [reference, declared]) {
        expect({
          emissions: trace.events.length,
          candidates: trace.events.reduce((total, event) => total + event.count, 0),
          interventions: trace.omittedOrRedirected,
          splitChildren: trace.splitChildren,
          hash: trace.traceSha256,
        }).toEqual({
          emissions: 12,
          candidates: expected[difficulty].candidates,
          interventions: expected[difficulty].interventions,
          splitChildren: 0,
          hash: expected[difficulty].hash,
        });
      }
      expect(declared.traceSha256).toBe(reference.traceSha256);
    }
  });

  it("keeps exact Absent Receiver spawn, arm, pause, and retry crossings across E/N/H", () => {
    const pattern = executablePattern("boss.absent_receiver.phase1");
    const expected = {
      EASY: {
        spawn: [93, 193, 294, 394, 494, 594, 695, 795, 895, 995, 1095, 1196],
        arm: [98, 198, 299, 399, 499, 599, 699, 800, 900, 1000, 1100, 1201],
        pause: [184, 285, 385, 485, 585, 686, 786, 886, 986, 1086, 1187, 1287],
        retry: [242, 342, 443, 543, 643, 743, 843, 944, 1044, 1144, 1244, 1345],
      },
      NORMAL: {
        spawn: [93, 180, 266, 352, 439, 525, 612, 698, 784, 871, 957, 1044],
        arm: [98, 184, 271, 357, 444, 530, 616, 703, 789, 876, 962, 1048],
        pause: [184, 271, 357, 444, 530, 616, 703, 789, 876, 962, 1048, 1135],
        retry: [242, 328, 415, 501, 588, 674, 760, 847, 933, 1020, 1106, 1192],
      },
      HARD: {
        spawn: [93, 169, 245, 321, 397, 473, 549, 625, 702, 778, 854, 930],
        arm: [98, 174, 250, 326, 402, 478, 554, 630, 706, 782, 858, 934],
        pause: [184, 260, 337, 413, 489, 565, 641, 717, 793, 869, 945, 1021],
        retry: [242, 318, 394, 470, 546, 622, 698, 774, 850, 926, 1002, 1078],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(
        expected[difficulty].spawn,
      );
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expected[difficulty].arm);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 760))).toEqual(
        expected[difficulty].pause,
      );
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 1240))).toEqual(
        expected[difficulty].retry,
      );
    }
    const easyFinalBurst = createPatternSchedule(pattern, "EASY").at(-1);
    expect(easyFinalBurst?.atMs).toBeCloseTo(9960.2, 10);
    expect(easyFinalBurst?.atMs).toBeLessThan(10100);

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.absent_receiver.phase1"),
      seed: ABSENT_RECEIVER_QUERY_REPORT_SEED,
    });
    const projectile = () => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === "absent_receiver-p1-primary"
        && entry.burstIndex === 0
        && entry.sourceIndex === 0);
      expect(candidate).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
    };
    stepTo(93);
    expect(projectile()).toMatchObject({
      state: "arm",
      spawnedAtTick: 93,
      armAtTick: 98,
      position: {x: 122.4, y: 64},
      speedPxPerSecond: 142,
      collisionEnabled: false,
    });
    stepTo(98);
    expect(projectile()).toMatchObject({
      state: "flight",
      position: {x: 122.4, y: 64},
      speedPxPerSecond: 142,
      collisionEnabled: true,
    });
    stepTo(183);
    expect(projectile().position.x).toBeCloseTo(192.45442497013306, 12);
    expect(projectile().position.y).toBeCloseTo(136.1760658843936, 12);
    expect(projectile().speedPxPerSecond).toBe(142);
    stepTo(184);
    const paused = projectile();
    expect(paused.position.x).toBeCloseTo(193.2456278874428, 12);
    expect(paused.position.y).toBeCloseTo(136.99123086379382, 12);
    expect(paused.speedPxPerSecond).toBe(0);
    stepTo(241);
    expect(projectile()).toMatchObject({position: paused.position, speedPxPerSecond: 0});
    stepTo(242);
    const retried = projectile();
    expect(retried.position.x).toBeCloseTo(193.69892122548484, 12);
    expect(retried.position.y).toBeCloseTo(137.4582524665752, 12);
    expect(retried.speedPxPerSecond).toBe(177.5);
    stepTo(243);
    expect(projectile().position.x).toBeCloseTo(194.72913335739855, 12);
    expect(projectile().position.y).toBeCloseTo(138.51966520016921, 12);
  });

  it("preflights Absent Receiver retries with the same envelope sweep used at runtime", () => {
    const pattern = executablePattern("boss.absent_receiver.phase1");
    const expected = {
      EASY: {candidates: 60, preflight: 9, spawn: 51, outOfBounds: 28, patternEnd: 23},
      NORMAL: {candidates: 84, preflight: 10, spawn: 74, outOfBounds: 53, patternEnd: 21},
      HARD: {candidates: 96, preflight: 3, spawn: 93, outOfBounds: 79, patternEnd: 14},
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("boss.absent_receiver.phase1"),
        seed: ABSENT_RECEIVER_QUERY_REPORT_SEED,
        difficulty,
      });
      const schedule = createPatternSchedule(pattern, difficulty);
      const candidates = schedule.reduce((total, scheduled) => total + roundPatternCount(
        scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      ), 0);
      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, snapshot.relativeTick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }
      const events = kernel.events();
      const spawnCommits = events.filter((event) => event.id === "projectile.spawn.commit").length;
      const countCancellation = (reason: string): number => events.filter((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === reason).length;
      expect({
        candidates,
        preflight: kernel.snapshot().rngCallsConsumed - spawnCommits,
        spawn: spawnCommits,
        outOfBounds: countCancellation("out_of_bounds"),
        patternEnd: countCancellation("pattern_end"),
      }).toEqual(expected[difficulty]);
      expect(kernel.snapshot().rngCallsConsumed).toBe(candidates);
      expect(countCancellation("out_of_bounds") + countCancellation("pattern_end"))
        .toBe(spawnCommits);
      expect(events.filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
      expect(events.filter((event) => event.id === "player.damage.commit")).toEqual([]);
      expect(events.filter((event) => event.id.startsWith("laser."))).toEqual([]);
      expect(kernel.projectilePoolAudit()).toEqual([]);
    }
  });

  it("is render-cadence invariant through Absent Receiver pause and retry boundaries", () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveAbsentReceiverQueryWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
    );
    const at144Hz = driveAbsentReceiverQueryWithDeltas(
      Array.from({length: 504}, () => 1000 / 144),
      targetTick120,
    );
    const retainedBacklog = driveAbsentReceiverQueryWithDeltas([durationMs], targetTick120);
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(retainedBacklog.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(retainedBacklog.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("ends Absent Receiver query flight at 1296 without starting its family laser", () => {
    const pattern = executablePattern("boss.absent_receiver.phase1");
    expect(crossedTickCount(pattern.durationMs)).toBe(1296);
    expect(crossedTickCount(2391)).toBe(287);
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.absent_receiver.phase1"),
      seed: ABSENT_RECEIVER_QUERY_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 1296; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1296,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
      poolUsage: {liveColliders: 0},
    });
    expect(kernel.snapshot().projectiles).toHaveLength(43);
    expect(kernel.snapshot().projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(kernel.events().filter((event) =>
      event.tick120 === 1296
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toHaveLength(21);
    expect(kernel.events().filter((event) => event.id.startsWith("laser."))).toEqual([]);
    expect(kernel.events().filter((event) => event.id.startsWith("boss.phase."))).toEqual([]);
    expect(kernel.events().filter((event) => event.id === "boss.protocol.withdraw")).toEqual([]);

    for (let tick120 = 1297; tick120 <= 1582; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1582,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles).toHaveLength(21);
    kernel.step(safeGapFollowingInput(kernel, pattern, 1583));
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1583,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(kernel.events().filter((event) =>
      event.tick120 === 1583 && event.id === "projectile.residue.remove")).toHaveLength(21);
    expect(kernel.events().filter((event) => event.id.startsWith("boss.phase."))).toEqual([]);
  });

  it("pins the immutable hard-cut wall, lane path, step envelope, and compiler provenance", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.hard_cut_corridor"),
      seed: HARD_CUT_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(contract).toMatchObject({
      id: "room.polarized.hard_cut_corridor",
      room: "POLARIZED",
      durationMs: 10800,
      warning: {
        durationMs: 693,
        shape: "hard_edge_lane_map",
        coversSweptArea: true,
        collisionEnabled: false,
      },
      safeGap: {
        type: "hard_lane_swap",
        minimumWidthPx: 42,
        enforcement: "lane_omission",
        path: {
          centerX: 180,
          amplitudePx: 0,
          periodMs: 4800,
          phase: 0,
          laneX: [96, 180, 264],
          maxTravelPxPerSec: 78,
        },
      },
      residue: {
        type: "binary_chip",
        lifetimeMs: 2596,
        density: 0.24,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
    });
    expect(contract.emitters).toHaveLength(1);
    expect(contract.emitters[0]).toMatchObject({
      id: "cut-columns",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.02},
      geometry: {
        type: "wall",
        variant: "three-position-shutter",
        count: 14,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 693, intervalMs: 800, bursts: 12, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {keys: [{atMs: 0, pxPerSec: 164}]},
      motionStack: [
        {operator: "op.lateral_wall", params: {laneCount: 14, openLane: 7, driftPxPerSec: 0}},
        {
          operator: "op.speed_envelope",
          params: {
            keys: [
              {atMs: 0, multiplier: 1},
              {atMs: 420, multiplier: 0},
              {atMs: 680, multiplier: 1},
            ],
            interpolation: "step",
          },
        },
        {operator: "op.linear", params: {}},
      ],
    });

    const expected = {
      EASY: {
        emissions: 11,
        candidates: 121,
        referenceInterventions: 30,
        referenceHash: "848e6b01d2d5a9d6ab0165aa70af5182827e5e190dcff1a4d12b85a824b5a9c8",
        declaredInterventions: 24,
        declaredHash: "468cc841f604d29760c6c905bdadc869a9dcd44f550c80a03e41066b44a8783e",
      },
      NORMAL: {
        emissions: 12,
        candidates: 168,
        referenceInterventions: 42,
        referenceHash: "a297e3d11a7331787c529af3d65c010ce67f64fa43a78219959bc40c6b9a8729",
        declaredInterventions: 34,
        declaredHash: "c7f2416c57102c67b05bd2d217adcedba47e353d1e4346ad19062bde7bcffdf4",
      },
      HARD: {
        emissions: 12,
        candidates: 204,
        referenceInterventions: 54,
        referenceHash: "56f76982854abad3f9e9d988ed5736ab29f202a1a3089300bf16d4ef02da285e",
        declaredInterventions: 39,
        declaredHash: "ec66a47e3d1eb778a13674dec36adb2865d2a8bd749d2aae2d511a6d7505df99",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: HARD_CUT_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: HARD_CUT_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect({
        emissions: reference.events.length,
        candidates: reference.events.reduce((total, event) => total + event.count, 0),
        interventions: reference.omittedOrRedirected,
        splitChildren: reference.splitChildren,
        hash: reference.traceSha256,
      }).toEqual({
        emissions: expected[difficulty].emissions,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].referenceInterventions,
        splitChildren: 0,
        hash: expected[difficulty].referenceHash,
      });
      expect({
        emissions: declared.events.length,
        candidates: declared.events.reduce((total, event) => total + event.count, 0),
        interventions: declared.omittedOrRedirected,
        splitChildren: declared.splitChildren,
        hash: declared.traceSha256,
      }).toEqual({
        emissions: expected[difficulty].emissions,
        candidates: expected[difficulty].candidates,
        interventions: expected[difficulty].declaredInterventions,
        splitChildren: 0,
        hash: expected[difficulty].declaredHash,
      });
      expect(declared.traceSha256).not.toBe(reference.traceSha256);
    }
  });

  it("fails closed on hostile speed-envelope records and unsafe adjacent timing", () => {
    const valid = {
      keys: [
        {atMs: 0, multiplier: 1},
        {atMs: 420, multiplier: 0},
        {atMs: 680, multiplier: 1},
      ],
      interpolation: "step",
    } as const;
    expect(() => validateSpeedEnvelopeParameters(valid)).not.toThrow();
    expect(() => validateSpeedEnvelopeParameters({
      keys: [
        {atMs: 0, multiplier: 1},
        {atMs: 1200, multiplier: 0.42},
        {atMs: 2100, multiplier: 0},
      ],
      interpolation: "linear",
    })).not.toThrow();
    for (const invalid of [
      {keys: valid.keys},
      {...valid, interpolation: "cubic"},
      {...valid, extra: true},
      {...valid, keys: []},
      {...valid, keys: [{atMs: 1, multiplier: 1}]},
      {...valid, keys: [{atMs: 0, multiplier: 1}, {atMs: 0, multiplier: 0}]},
      {...valid, keys: [{atMs: 0, multiplier: 1}, {atMs: -0, multiplier: 0}]},
      {...valid, keys: [{atMs: 0, multiplier: 1}, {atMs: Number.MAX_SAFE_INTEGER + 1, multiplier: 0}]},
      {...valid, keys: [{atMs: 0, multiplier: -0}]},
      {...valid, keys: [{atMs: 0, multiplier: Number.NaN}]},
      {...valid, keys: [{atMs: 0, multiplier: 1, extra: true}]},
    ]) {
      expect(() => validateSpeedEnvelopeParameters(invalid as Readonly<Record<string, unknown>>))
        .toThrow();
    }

    const sparse = Array(3) as unknown[];
    sparse[0] = {atMs: 0, multiplier: 1};
    sparse[2] = {atMs: 680, multiplier: 1};
    expect(() => validateSpeedEnvelopeParameters({keys: sparse, interpolation: "step"})).toThrow(/dense/);
    const metadata = [...valid.keys] as Array<unknown> & {metadata?: boolean};
    metadata.metadata = true;
    expect(() => validateSpeedEnvelopeParameters({keys: metadata, interpolation: "step"}))
      .toThrow(/metadata/);
    const customArray = [...valid.keys];
    Object.setPrototypeOf(customArray, {});
    expect(() => validateSpeedEnvelopeParameters({keys: customArray, interpolation: "step"}))
      .toThrow(/plain array/);
    const giantSparse: unknown[] = [];
    giantSparse.length = 1_000_000_000;
    expect(() => validateSpeedEnvelopeParameters({keys: giantSparse, interpolation: "step"}))
      .toThrow(/must not exceed 16/);

    let keyReads = 0;
    const accessorKey = Object.defineProperty({multiplier: 1}, "atMs", {
      enumerable: true,
      get() {
        keyReads += 1;
        return 0;
      },
    });
    expect(() => validateSpeedEnvelopeParameters({keys: [accessorKey], interpolation: "step"}))
      .toThrow(/own data property/);
    expect(keyReads).toBe(0);
    let elementReads = 0;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        elementReads += 1;
        return valid.keys[0];
      },
    });
    expect(() => validateSpeedEnvelopeParameters({keys: accessorArray, interpolation: "step"}))
      .toThrow(/data element/);
    expect(elementReads).toBe(0);
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(() => validateSpeedEnvelopeParameters({keys: revoked.proxy, interpolation: "step"}))
      .toThrow(/inspected safely/);

    expect(() => crossedTickCount(-0)).toThrow(/negative zero/);
    expect(() => crossedTickCount(Number.MAX_VALUE)).toThrow(/safe tick120/);
    expect(() => validateLateralWallParameters({laneCount: 14, openLane: 7, driftPxPerSec: -0}))
      .toThrow(/negative zero/);
    expect(() => new CanonicalCombatKernel({...OPTIONS, seed: -0})).toThrow(/negative zero/);
    expect(() => new CanonicalCombatKernel({...OPTIONS, startTick120: -0})).toThrow(/negative zero/);
    const kernel = new CanonicalCombatKernel(OPTIONS);
    expect(() => kernel.step({...inputAt(-0), tick120: -0})).toThrow(/negative zero/);
    expect(kernel.snapshot().tick120).toBe(0);
  });

  it("keeps exact hard-cut spawn, pause, and release crossings across every difficulty", () => {
    const pattern = executablePattern("room.polarized.hard_cut_corridor");
    const expected = {
      EASY: {
        spawn: [84, 195, 306, 418, 529, 640, 752, 863, 975, 1086, 1197],
        pause: [134, 245, 357, 468, 579, 691, 802, 914, 1025, 1136, 1248],
        release: [165, 277, 388, 499, 611, 722, 833, 945, 1056, 1167, 1279],
      },
      NORMAL: {
        spawn: [84, 180, 276, 372, 468, 564, 660, 756, 852, 948, 1044, 1140],
        pause: [134, 230, 326, 422, 518, 614, 710, 806, 902, 998, 1094, 1190],
        release: [165, 261, 357, 453, 549, 645, 741, 837, 933, 1029, 1125, 1221],
      },
      HARD: {
        spawn: [84, 168, 253, 337, 422, 506, 591, 675, 759, 844, 928, 1013],
        pause: [134, 219, 303, 387, 472, 556, 641, 725, 810, 894, 979, 1063],
        release: [165, 250, 334, 419, 503, 588, 672, 757, 841, 926, 1010, 1095],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(expected[difficulty].spawn);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 420))).toEqual(expected[difficulty].pause);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 680))).toEqual(expected[difficulty].release);
    }

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.hard_cut_corridor"),
      seed: HARD_CUT_REPORT_SEED,
    });
    const projectile = () => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === "cut-columns" && entry.burstIndex === 0 && entry.sourceIndex === 0);
      expect(candidate).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    stepTo(84);
    expect(projectile()).toMatchObject({
      state: "arm",
      spawnedAtTick: 84,
      armAtTick: 88,
      speedPxPerSecond: 164,
      collisionEnabled: false,
    });
    stepTo(88);
    expect(projectile()).toMatchObject({state: "flight", collisionEnabled: true});
    stepTo(133);
    const beforePause = projectile();
    expect(beforePause.speedPxPerSecond).toBe(164);
    stepTo(134);
    const paused = projectile();
    expect(paused).toMatchObject({state: "flight", speedPxPerSecond: 0, collisionEnabled: true});
    expect(paused.position.x).toBe(beforePause.position.x);
    expect(paused.position.y - beforePause.position.y).toBeCloseTo(
      164 * (1113 - 133 * 1000 / 120) / 1000,
      12,
    );
    stepTo(164);
    expect(projectile()).toMatchObject({
      position: paused.position,
      state: "flight",
      speedPxPerSecond: 0,
      collisionEnabled: true,
    });
    stepTo(165);
    const released = projectile();
    expect(released).toMatchObject({state: "flight", speedPxPerSecond: 164, collisionEnabled: true});
    expect(released.position.y - paused.position.y).toBeCloseTo(
      164 * (165 * 1000 / 120 - 1373) / 1000,
      12,
    );
    stepTo(166);
    expect(projectile().position.y - released.position.y).toBeCloseTo(164 / 120, 12);

    const exactKeyCases = [
      {difficulty: "EASY", burstIndex: 4, keyTick: 579, before: 144.32, after: 0},
      {difficulty: "HARD", burstIndex: 3, keyTick: 387, before: 183.68, after: 0},
    ] as const;
    for (const keyCase of exactKeyCases) {
      const keyed = new CanonicalCombatKernel({
        ...optionsFor("room.polarized.hard_cut_corridor"),
        seed: HARD_CUT_REPORT_SEED,
        difficulty: keyCase.difficulty,
      });
      const speed = (): number | undefined => keyed.snapshot().projectiles.find((entry) =>
        entry.sourceId === "cut-columns"
        && entry.burstIndex === keyCase.burstIndex
        && entry.sourceIndex === 0)?.speedPxPerSecond;
      for (let tick120 = 1; tick120 <= keyCase.keyTick; tick120 += 1) {
        keyed.step({...inputAt(tick120), focused: false});
      }
      expect(speed()).toBe(keyCase.before);
      keyed.step({...inputAt(keyCase.keyTick + 1), focused: false});
      expect(speed()).toBe(keyCase.after);
    }

    // Keep the immutable TS/Python scheduler's IEEE-754 authored timestamp.
    // EASY burst 9 is microscopically before 9045ms, so tick 1167 is already
    // past the 680ms key rather than an exact left-continuous key sample.
    const easyBurstNine = createPatternSchedule(pattern, "EASY").find((entry) =>
      entry.burstIndex === 9);
    expect(easyBurstNine?.atMs).toBe(9044.999999999998);
    expect(1167 * 1000 / 120 - (easyBurstNine?.atMs ?? Number.NaN)).toBeGreaterThan(680);
    const postKey = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.hard_cut_corridor"),
      seed: HARD_CUT_REPORT_SEED,
      difficulty: "EASY",
    });
    const postKeySpeed = (): number | undefined => postKey.snapshot().projectiles.find((entry) =>
      entry.sourceId === "cut-columns"
      && entry.burstIndex === 9
      && entry.sourceIndex === 0)?.speedPxPerSecond;
    for (let tick120 = 1; tick120 <= 1166; tick120 += 1) {
      postKey.step({...inputAt(tick120), focused: false});
    }
    expect(postKeySpeed()).toBe(0);
    postKey.step({...inputAt(1167), focused: false});
    expect(postKeySpeed()).toBe(144.32);
  });

  it("omits hard-cut lanes before RNG and preflights every retained body across E/N/H", () => {
    const pattern = executablePattern("room.polarized.hard_cut_corridor");
    const expected = {
      EASY: {candidates: 121, lane: 11, rng: 110, preflight: 25, spawn: 85, outOfBounds: 33, patternEnd: 52},
      NORMAL: {candidates: 168, lane: 12, rng: 156, preflight: 35, spawn: 121, outOfBounds: 63, patternEnd: 58},
      HARD: {candidates: 204, lane: 24, rng: 180, preflight: 40, spawn: 140, outOfBounds: 100, patternEnd: 40},
    } as const;
    const expectedOpeningSourceIndices = {
      EASY: [5],
      NORMAL: [7],
      HARD: [8, 9],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.polarized.hard_cut_corridor"),
        seed: HARD_CUT_REPORT_SEED,
        difficulty,
      });
      const schedule = createPatternSchedule(pattern, difficulty);
      let candidates = 0;
      let laneOmissions = 0;
      const firstOpeningSourceIndices: number[] = [];
      for (const scheduled of schedule) {
        const count = roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        );
        candidates += count;
        const lateral = scheduled.emitter.motionStack.find((entry) =>
          entry.operator === "op.lateral_wall");
        expect(lateral).toBeDefined();
        const laneCount = lateral?.params.laneCount as number;
        const openLane = lateral?.params.openLane as number;
        for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
          const lane = Math.min(
            laneCount - 1,
            Math.floor((sourceIndex + 0.5) * laneCount / count),
          );
          if (lane === openLane) {
            laneOmissions += 1;
            if (scheduled.burstIndex === 0) firstOpeningSourceIndices.push(sourceIndex);
          }
        }
      }
      expect(firstOpeningSourceIndices).toEqual(expectedOpeningSourceIndices[difficulty]);

      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, snapshot.relativeTick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
                - 1e-9,
            );
          }
        }
      }
      const events = kernel.events();
      const spawnCommits = events.filter((event) => event.id === "projectile.spawn.commit").length;
      const preflightOmissions = kernel.snapshot().rngCallsConsumed - spawnCommits;
      const countCancellation = (reason: string): number => events.filter((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === reason).length;
      expect({
        candidates,
        lane: laneOmissions,
        rng: kernel.snapshot().rngCallsConsumed,
        preflight: preflightOmissions,
        spawn: spawnCommits,
        outOfBounds: countCancellation("out_of_bounds"),
        patternEnd: countCancellation("pattern_end"),
      }).toEqual(expected[difficulty]);
      expect(candidates - laneOmissions).toBe(kernel.snapshot().rngCallsConsumed);
      expect(kernel.snapshot().rngCallsConsumed - preflightOmissions).toBe(spawnCommits);
      expect(countCancellation("out_of_bounds") + countCancellation("pattern_end")).toBe(spawnCommits);
      expect(countCancellation("source_withdrawn")).toBe(0);
      expect(kernel.projectilePoolAudit()).toEqual([]);
      expect(events.filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
      expect(events.filter((event) => event.id === "player.damage.commit")).toEqual([]);
    }
  });

  it("subdivides moving-player contact at the exact release key before same-tick damage", () => {
    const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
    const pausedProjectileY = 75.06533333333348;
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.hard_cut_corridor"),
      seed: HARD_CUT_REPORT_SEED,
      initialPlayerPosition: {x: 60, y: pausedProjectileY - 5.1},
    });
    for (let tick120 = 1; tick120 <= 164; tick120 += 1) {
      kernel.step({
        ...inputAt(tick120),
        focused: false,
        movement: tick120 >= 135 && tick120 <= 155
          ? {x: -1, y: 0}
          : tick120 === 156
            ? {x: -0.5257142857142858 / maximumTravel, y: 0}
            : {x: 0, y: 0},
      });
    }
    expect(kernel.snapshot().lastDamageBatch).toBeNull();
    expect(kernel.snapshot().playerPosition.x).toBeCloseTo(26.574285714285715, 12);
    expect(kernel.snapshot().playerPosition.y).toBeCloseTo(pausedProjectileY - 5.1, 12);
    kernel.step({
      ...inputAt(165),
      focused: false,
      movement: {x: 1.5 / maximumTravel, y: 0.328 / maximumTravel},
    });
    expect(kernel.snapshot().lastDamageBatch).toMatchObject({
      tick120: 165,
      committedSourceId: "combat:room.polarized.hard_cut_corridor/micro/0000:0",
      branch: "non-fatal",
    });
    const events = kernel.events().filter((event) => event.tick120 === 165);
    const collisionOff = events.findIndex((event) => event.id === "projectile.collision.off");
    const impact = events.findIndex((event) => event.id === "projectile.impact.commit");
    const damage = events.findIndex((event) => event.id === "player.damage.commit");
    expect(collisionOff).toBeGreaterThanOrEqual(0);
    expect(impact).toBeGreaterThan(collisionOff);
    expect(damage).toBeGreaterThan(collisionOff);
    expect(events[collisionOff]?.phasePriority).toBe(0);
    expect(events[impact]?.phasePriority).toBe(1);
    expect(events[damage]?.phasePriority).toBe(1);
    expect(kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === "combat:room.polarized.hard_cut_corridor/micro/0000"))
      .toMatchObject({
        sourceId: "cut-columns",
        state: "residue",
        collisionEnabled: false,
        speedPxPerSecond: 164,
      });
  });

  it("is render-cadence invariant through hard-cut pause and release boundaries", () => {
    const targetTick120 = 400;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveHardCutWithDeltas(
      Array.from({length: 100}, () => 1000 / 30),
      targetTick120,
    );
    const at144Hz = driveHardCutWithDeltas(
      Array.from({length: 480}, () => 1000 / 144),
      targetTick120,
    );
    const retainedBacklog = driveHardCutWithDeltas([durationMs], targetTick120);
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(retainedBacklog.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(retainedBacklog.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("ends hard-cut at 1296 and drains its 312-tick material residue at 1608", () => {
    const pattern = executablePattern("room.polarized.hard_cut_corridor");
    expect(crossedTickCount(pattern.durationMs)).toBe(1296);
    expect(crossedTickCount(2596)).toBe(312);
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.hard_cut_corridor"),
      seed: HARD_CUT_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 1296; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1296,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
      poolUsage: {liveColliders: 0},
    });
    expect(kernel.snapshot().projectiles.length).toBeGreaterThan(0);
    expect(kernel.snapshot().projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(kernel.events().filter((event) =>
      event.tick120 === 1296
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toHaveLength(58);

    for (let tick120 = 1297; tick120 <= 1607; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1607,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(kernel.snapshot().projectiles).toHaveLength(58);
    kernel.step(safeGapFollowingInput(kernel, pattern, 1608));
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1608,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(kernel.events().filter((event) =>
      event.tick120 === 1608 && event.id === "projectile.residue.remove")).toHaveLength(58);
  });

  it("pins the exact Alternating contract, omission adapter, and separate V4 oracle evidence", () => {
    expect(() => validateTurnOnceParameters({atMs: 640, deltaDeg: 32})).not.toThrow();
    expect(() => validateTurnOnceParameters({atMs: 940, deltaDeg: -32})).not.toThrow();
    expect(() => validateTurnOnceParameters({deltaDeg: 32})).toThrow(/parameter contract drifted/);
    expect(() => validateTurnOnceParameters({atMs: 640})).toThrow(/parameter contract drifted/);
    expect(() => validateTurnOnceParameters({atMs: 640, deltaDeg: 32, repeats: 2}))
      .toThrow(/parameter contract drifted/);
    expect(() => validateTurnOnceParameters({atMs: -1, deltaDeg: 32})).toThrow(/atMs/);
    expect(() => validateTurnOnceParameters({atMs: Number.NaN, deltaDeg: 32})).toThrow(/atMs/);
    expect(() => validateTurnOnceParameters({atMs: 640, deltaDeg: Number.POSITIVE_INFINITY}))
      .toThrow(/deltaDeg/);

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.alternating_verdict"),
      seed: ALTERNATING_VERDICT_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateAlternatingVerdictPatternContract(contract)).not.toThrow();
    expect(contract).toMatchObject({
      id: "room.polarized.alternating_verdict",
      category: "ROOM",
      room: "POLARIZED",
      name: {zh: "交替裁决", en: "Alternating verdict"},
      durationMs: 11600,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 547, event: "collision.arm"},
        {atMs: 547, event: "emit.begin"},
        {atMs: 5800, event: "pattern.midpoint"},
        {atMs: 10900, event: "emit.end"},
        {atMs: 11180, event: "residue.commit"},
        {atMs: 11600, event: "pattern.complete"},
      ],
      warning: {
        durationMs: 547,
        shape: "alternating_turn_wedges",
        coversSweptArea: true,
        collisionEnabled: false,
      },
      safeGap: {
        type: "alternating_wedge",
        minimumWidthPx: 34,
        focusMinimumWidthPx: 26,
        enforcement: "angular_omission",
        path: {centerX: 180, amplitudePx: 64, periodMs: 5600, maxTravelPxPerSec: 78},
      },
      residue: {type: "binary_chip", lifetimeMs: 2422, density: 0.37},
      seed: {base: 4224141244},
    });
    expect(contract.emitters.map((emitter) => ({
      id: emitter.id,
      geometry: emitter.geometry.type,
      operators: emitter.motionStack.map((motion) => motion.operator),
      params: emitter.motionStack[1]?.params,
    }))).toEqual([
      {
        id: "verdict-a",
        geometry: "arc",
        operators: ["op.linear", "op.turn_once"],
        params: {atMs: 640, deltaDeg: 32},
      },
      {
        id: "verdict-b",
        geometry: "arc",
        operators: ["op.linear", "op.turn_once"],
        params: {atMs: 940, deltaDeg: -32},
      },
    ]);
    expect(kernel.snapshot().adapterGaps.alternatingVerdictAngularOmission).toEqual({
      order:
        "geometry-source-index>one-rng-jitter>full-declaration-order-swept-preflight>entity-spawn",
      crossedTurnTick: "old-heading-sweep>zero-time-turn>new-heading-next-tick",
      spawnIdentity: "assigned-only-after-preflight-pass",
      residue: "omitted-candidates-have-no-events-or-residue",
      runtimeViolation: "fail-stop-never-source-withdrawn",
    });
    expect(ALTERNATING_VERDICT_REPORT_SEED).not.toBe(contract.seed.base);

    const expectedOracle = {
      EASY: [18, 162, 11, "159bef92d295d3d77be729b474b0cdaad27d899e5951d6762ff427b57a11ac1b"],
      NORMAL: [18, 198, 15, "cc74afc91498f6162d52ffbd4c260040ee74efaaea9eadb282d0721d2d1ffc1a"],
      HARD: [18, 234, 16, "3c9400027d091c1c42b5cc34a48478f8a60983a7ccb77aff56847f15c44dde12"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: ALTERNATING_VERDICT_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: ALTERNATING_VERDICT_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expectedOracle[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("rejects whole-pattern Alternating drift and hostile descriptors without invoking accessors", () => {
    const source = structuredClone(executablePattern("room.polarized.alternating_verdict")) as unknown as {
      durationMs: number;
      safeGap: {enforcement: string};
      emitters: Array<{
        cadence: {startMs: number};
        motionStack: Array<{operator: string; params: Record<string, unknown>}>;
      }>;
      metadata?: string;
    };
    expect(() => validateAlternatingVerdictPatternContract(source)).not.toThrow();

    const extra = structuredClone(source);
    extra.metadata = "presentation-write-back";
    expect(() => validateAlternatingVerdictPatternContract(extra)).toThrow(/contract drifted/);
    const missing = structuredClone(source) as Partial<typeof source>;
    delete missing.durationMs;
    expect(() => validateAlternatingVerdictPatternContract(missing)).toThrow(/contract drifted/);
    const cadenceDrift = structuredClone(source);
    cadenceDrift.emitters[0]!.cadence.startMs += 1;
    expect(() => validateAlternatingVerdictPatternContract(cadenceDrift)).toThrow(/exact contract drifted/);
    const enforcementDrift = structuredClone(source);
    enforcementDrift.safeGap.enforcement = "operator_constraint";
    expect(() => validateAlternatingVerdictPatternContract(enforcementDrift))
      .toThrow(/exact contract drifted/);
    const emitterOrder = structuredClone(source);
    emitterOrder.emitters.reverse();
    expect(() => validateAlternatingVerdictPatternContract(emitterOrder))
      .toThrow(/exact contract drifted/);
    const motionOrder = structuredClone(source);
    motionOrder.emitters[0]!.motionStack.reverse();
    expect(() => validateAlternatingVerdictPatternContract(motionOrder))
      .toThrow(/exact contract drifted/);
    const sparse = structuredClone(source);
    delete sparse.emitters[0]!.motionStack[0];
    expect(() => validateAlternatingVerdictPatternContract(sparse)).toThrow(/dense/);

    let reads = 0;
    const topAccessor = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        reads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateAlternatingVerdictPatternContract(topAccessor))
      .toThrow(/own data property/);
    const nestedAccessor = structuredClone(source);
    Object.defineProperty(nestedAccessor.emitters[0]!.motionStack[1]!.params, "atMs", {
      enumerable: true,
      get() {
        reads += 1;
        return 640;
      },
    });
    expect(() => validateAlternatingVerdictPatternContract(nestedAccessor))
      .toThrow(/own data property/);
    expect(reads).toBe(0);
  });

  it("moves on the old heading at A/B turn ticks 143/246, then moves on the new heading", () => {
    const startTick120 = 500;
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.alternating_verdict"),
      startTick120,
    });
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    const projectile = (sourceId: string, sourceIndex: number) => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === sourceId && entry.burstIndex === 0 && entry.sourceIndex === sourceIndex);
      expect(candidate, `${sourceId}:${sourceIndex}`).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };

    stepTo(startTick120 + 142);
    const beforeA = projectile("verdict-a", 0);
    stepTo(startTick120 + 143);
    const turnedA = projectile("verdict-a", 0);
    expect(turnedA.headingDegrees - beforeA.headingDegrees).toBeCloseTo(32, 12);
    expect(turnedA.position.x).toBeCloseTo(
      beforeA.position.x + Math.cos(beforeA.headingDegrees * Math.PI / 180)
        * turnedA.speedPxPerSecond / 120,
      12,
    );
    expect(turnedA.position.y).toBeCloseTo(
      beforeA.position.y + Math.sin(beforeA.headingDegrees * Math.PI / 180)
        * turnedA.speedPxPerSecond / 120,
      12,
    );
    stepTo(startTick120 + 144);
    const afterA = projectile("verdict-a", 0);
    expect(afterA.headingDegrees).toBe(turnedA.headingDegrees);
    expect(afterA.position.x).toBeCloseTo(
      turnedA.position.x + Math.cos(turnedA.headingDegrees * Math.PI / 180)
        * afterA.speedPxPerSecond / 120,
      12,
    );
    expect(afterA.position.y).toBeCloseTo(
      turnedA.position.y + Math.sin(turnedA.headingDegrees * Math.PI / 180)
        * afterA.speedPxPerSecond / 120,
      12,
    );

    stepTo(startTick120 + 245);
    const beforeB = projectile("verdict-b", 0);
    stepTo(startTick120 + 246);
    const turnedB = projectile("verdict-b", 0);
    expect(turnedB.headingDegrees - beforeB.headingDegrees).toBeCloseTo(-32, 12);
    expect(turnedB.position.x).toBeCloseTo(
      beforeB.position.x + Math.cos(beforeB.headingDegrees * Math.PI / 180)
        * turnedB.speedPxPerSecond / 120,
      12,
    );
    expect(turnedB.position.y).toBeCloseTo(
      beforeB.position.y + Math.sin(beforeB.headingDegrees * Math.PI / 180)
        * turnedB.speedPxPerSecond / 120,
      12,
    );
    stepTo(startTick120 + 247);
    const afterB = projectile("verdict-b", 0);
    expect(afterB.headingDegrees).toBe(turnedB.headingDegrees);
    expect(afterB.position.x).toBeCloseTo(
      turnedB.position.x + Math.cos(turnedB.headingDegrees * Math.PI / 180)
        * afterB.speedPxPerSecond / 120,
      12,
    );
    expect(afterB.position.y).toBeCloseTo(
      turnedB.position.y + Math.sin(turnedB.headingDegrees * Math.PI / 180)
        * afterB.speedPxPerSecond / 120,
      12,
    );
  });

  it("preflights the full pre/post-turn path and owns only admitted residue across E/N/H", {
    timeout: 20_000,
  }, () => {
    const expected = {
      EASY: {
        candidates: 162, preflight: 12, spawn: 150, outOfBounds: 99, patternEnd: 51,
        activeResidue: 83, allocated: 83, peakLive: 52, peakResidue: 83, peakBodies: 83,
        endEvents: 1334,
        endHash: "0b6cba1906a6c172c8fa68d34b3f47595edf1756847e94850dec2d1f18d773eb",
        fullEvents: 1500,
        fullHash: "b7f2b9bca9fd76bce42f245cfd4cae302aec8297c19a836e6b38ad4e46e77a7f",
      },
      NORMAL: {
        candidates: 198, preflight: 15, spawn: 183, outOfBounds: 147, patternEnd: 36,
        activeResidue: 79, allocated: 106, peakLive: 61, peakResidue: 79, peakBodies: 106,
        endEvents: 1672,
        endHash: "62ef4cbd2fe769fc53d8653c6010c4987f0bd5652e32c6e3d4a0c4e66e78b02b",
        fullEvents: 1830,
        fullHash: "25a0fdd4617d491a33aa6fa9502af447dc5e6103582844c16ab9a81fddd22969",
      },
      HARD: {
        candidates: 234, preflight: 15, spawn: 219, outOfBounds: 201, patternEnd: 18,
        activeResidue: 70, allocated: 136, peakLive: 76, peakResidue: 70, peakBodies: 136,
        endEvents: 2050,
        endHash: "d3839818426b980b0bb14e6851091d0aae29a4eda00e1efffcab1bde28aa736f",
        fullEvents: 2190,
        fullHash: "92a7f8055a6703289bae5e570d7e07583cc5c8c7fbf7ade38c5a3e2b7a9c4c87",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.polarized.alternating_verdict"),
        seed: ALTERNATING_VERDICT_REPORT_SEED,
        difficulty,
      });
      const pattern = kernel.patternContractSnapshot();
      const facts = expected[difficulty];
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      let peakLive = 0;
      let peakResidue = 0;
      let peakBodies = 0;
      for (let tick120 = 1; tick120 <= crossedTickCount(pattern.durationMs); tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const relativeMs = snapshot.relativeTick120 * 1000 / 120;
        const corridorCenter = safeGapCenter(pattern, relativeMs);
        peakLive = Math.max(peakLive, snapshot.poolUsage.liveColliders);
        peakResidue = Math.max(peakResidue, snapshot.poolUsage.residueVisuals);
        peakBodies = Math.max(peakBodies, snapshot.projectiles.length);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            minimumCollisionMargin = Math.min(
              minimumCollisionMargin,
              Math.abs(projectile.position.x - corridorCenter) - (
                safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
                + 78 / 120
              ),
            );
          }
        }
      }
      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      const candidates = createPatternSchedule(pattern, difficulty).reduce((total, entry) =>
        total + roundPatternCount(
          entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        ), 0);
      const spawnIdentities = new Set(events
        .filter((event) => event.id === "projectile.spawn.commit")
        .map((event) => `${event.entityStableId}:${String(event.payload.generation)}`));
      const projectileEvents = events.filter((event) =>
        event.entityStableId.startsWith("combat:room.polarized.alternating_verdict/"));
      expect([...spawnIdentities]).toHaveLength(facts.spawn);
      expect(projectileEvents.every((event) => spawnIdentities.has(
        `${event.entityStableId}:${String(event.payload.generation)}`,
      ))).toBe(true);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect({
        candidates,
        rng: kernel.snapshot().rngCallsConsumed,
        preflight: kernel.snapshot().rngCallsConsumed - count("projectile.spawn.commit"),
        spawn: count("projectile.spawn.commit"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        impact: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        activeResidue: kernel.snapshot().projectiles.length,
        allocated: kernel.snapshot().poolUsage.allocatedSlots.micro,
        peakLive,
        peakResidue,
        peakBodies,
        eventCount: events.length,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        candidates: facts.candidates,
        rng: facts.candidates,
        preflight: facts.preflight,
        spawn: facts.spawn,
        sourceWithdrawn: 0,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        impact: 0,
        damage: 0,
        activeResidue: facts.activeResidue,
        allocated: facts.allocated,
        peakLive: facts.peakLive,
        peakResidue: facts.peakResidue,
        peakBodies: facts.peakBodies,
        eventCount: facts.endEvents,
        hash: facts.endHash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1392,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        player: {health: 3},
        evidence: {amount: 0},
        poolUsage: {liveColliders: 0, residueVisuals: facts.activeResidue},
      });
      expect(kernel.projectilePoolAudit()).toEqual([]);

      for (let tick120 = 1393; tick120 <= 1683; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      const fullEvents = kernel.events();
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1683,
        projectileLifecycleDrained: true,
        handoffReady: true,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
      });
      expect(fullEvents.filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(facts.spawn);
      expect(fullEvents.filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(facts.spawn);
      expect(fullEvents).toHaveLength(facts.fullEvents);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.fullHash);
    }
  });

  it("fail-stops an impossible post-preflight violation without authoring withdrawal residue", () => {
    const pattern = executablePattern("room.polarized.alternating_verdict");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.alternating_verdict"),
      occurrenceId: "alternating:preflight-fault",
      initialPlayerPosition: {x: 180, y: 570},
      seed: ALTERNATING_VERDICT_REPORT_SEED,
      difficulty: "EASY",
    });
    for (let tick120 = 1; tick120 <= 72; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    const internals = kernel as unknown as {
      runtimeProjectiles: Map<string, {
        position: {x: number; y: number};
        headingDegrees: number;
        speedPxPerSecond: number;
      }>;
    };
    const runtime = [...internals.runtimeProjectiles.values()][0];
    expect(runtime).toBeDefined();
    if (runtime === undefined) throw new Error("Alternating fixture has no admitted runtime body");
    const radians = runtime.headingDegrees * Math.PI / 180;
    const nextTickCenter = safeGapCenter(pattern, 73 * 1000 / 120);
    runtime.position = {
      x: nextTickCenter - Math.cos(radians) * runtime.speedPxPerSecond / 120,
      y: 570 - Math.sin(radians) * runtime.speedPxPerSecond / 120,
    };

    expect(() => kernel.step(safeGapFollowingInput(kernel, pattern, 73)))
      .toThrow(/admitted projectile violated its complete swept preflight/);
    expect(kernel.events().some((event) =>
      event.id === "projectile.cancel.commit"
      && event.payload.reason === "source_withdrawn")).toBe(false);
    expect(() => kernel.step(safeGapFollowingInput(kernel, pattern, 74)))
      .toThrow(/canonical combat kernel is faulted/);
  });

  it("resolves a post-turn swept hit with collision-off before damage", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.alternating_verdict"),
      seed: 0x1b17c0de,
      difficulty: "HARD",
      initialPlayerPosition: {x: 0, y: 570},
    });
    for (let tick120 = 1; tick120 <= 419; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    const events = kernel.events().filter((event) => event.tick120 === 419);
    const collisionOffIndex = events.findIndex((event) => event.id === "projectile.collision.off");
    const impactIndex = events.findIndex((event) => event.id === "projectile.impact.commit");
    const damageIndex = events.findIndex((event) => event.id === "player.damage.commit");
    expect(collisionOffIndex).toBeGreaterThanOrEqual(0);
    expect(impactIndex).toBeGreaterThan(collisionOffIndex);
    expect(damageIndex).toBeGreaterThan(collisionOffIndex);
    expect(events[collisionOffIndex]?.phasePriority).toBe(0);
    expect(kernel.snapshot().lastDamageBatch).toMatchObject({
      tick120: 419,
      committedSourceId: "combat:room.polarized.alternating_verdict/micro/0005:0",
      branch: "non-fatal",
    });
    expect(kernel.snapshot().projectiles.find((entry) =>
      entry.instanceId === "combat:room.polarized.alternating_verdict/micro/0005")).toMatchObject({
      sourceId: "verdict-a",
      headingDegrees: 107.81213422527351,
      state: "residue",
      collisionEnabled: false,
    });
  });

  it("keeps cadence, presentation projection, and nonzero-start authority identical", {
    timeout: 10_000,
  }, () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const at30Hz = driveAlternatingVerdictWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveAlternatingVerdictWithDeltas(
        Array.from({length: 210}, () => 1000 / 60),
        targetTick120,
        "reduced-motion/default-flash/rain",
      ),
      driveAlternatingVerdictWithDeltas(
        Array.from({length: 504}, () => 1000 / 144),
        targetTick120,
        "full-motion/flash-off/ash",
      ),
      driveAlternatingVerdictWithDeltas(
        [durationMs],
        targetTick120,
        "reduced-motion/flash-off/sleet",
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(at30Hz.snapshot());
    }

    const pattern = executablePattern("room.polarized.alternating_verdict");
    const offsetTick120 = 401;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.alternating_verdict"),
      seed: ALTERNATING_VERDICT_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.alternating_verdict"),
      seed: ALTERNATING_VERDICT_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number): void => {
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120: kernel.snapshot().startTick120 + relativeTick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= targetTick120; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
  });

  it("drains Alternating residue and closes the final tick with the single flush", {
    timeout: 10_000,
  }, () => {
    const pattern = executablePattern("room.polarized.alternating_verdict");
    const occurrenceId = "alternating:lifecycle";
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.alternating_verdict"),
      occurrenceId,
      initialPlayerPosition: {x: 180, y: 570},
      seed: ALTERNATING_VERDICT_REPORT_SEED,
      difficulty: "EASY",
    });
    for (let tick120 = 1; tick120 <= 1392; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1392,
      patternComplete: true,
      digitalBodiesDrained: true,
      materialResidueDraining: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
      poolUsage: {liveColliders: 0, residueVisuals: 83},
    });
    expect(kernel.snapshot().projectiles).toHaveLength(83);
    expect(kernel.snapshot().projectiles.every((projectile) => projectile.state === "residue")).toBe(true);
    expect(kernel.events().filter((event) =>
      event.tick120 === 1392
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end")).toHaveLength(51);

    for (let tick120 = 1393; tick120 <= 1682; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    expect(kernel.snapshot()).toMatchObject({tick120: 1682, projectileLifecycleDrained: false});
    expect(kernel.snapshot().projectiles).toHaveLength(51);
    const eventsBeforeFinalAdvance = kernel.events().length;
    const prepared = kernel.advanceTick(safeGapFollowingInput(kernel, pattern, 1683));
    expect(prepared).toMatchObject({
      tick120: 1683,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(kernel.events()).toHaveLength(eventsBeforeFinalAdvance);
    const flushed = kernel.flushTick(1683);
    expect(flushed.filter((event) => event.id === "projectile.residue.remove")).toHaveLength(51);
    expect(flushed.filter((event) => event.id === "projectile.lifecycle.complete")).toHaveLength(51);
    expect(kernel.snapshot()).toMatchObject({
      tick120: 1683,
      handoffReady: true,
    });
  });

  it("samples lockAtMs zero at spawn and preserves a run-scoped initial player position", () => {
    const left = new CanonicalCombatKernel({
      ...optionsFor("boss.misreader.phase1"),
      initialPlayerPosition: {x: 48, y: 570},
    });
    const right = new CanonicalCombatKernel({
      ...optionsFor("boss.misreader.phase1"),
      initialPlayerPosition: {x: 312, y: 570},
    });
    expect(left.snapshot().playerPosition).toEqual({x: 48, y: 570});
    expect(right.snapshot().playerPosition).toEqual({x: 312, y: 570});
    for (let tick120 = 1; tick120 <= 92; tick120 += 1) {
      left.step({...inputAt(tick120), focused: false});
      right.step({...inputAt(tick120), focused: false});
    }
    const leftBySource = new Map(left.snapshot().projectiles.map((projectile) => [
      projectile.sourceIndex,
      projectile.headingDegrees,
    ]));
    const rightBySource = new Map(right.snapshot().projectiles.map((projectile) => [
      projectile.sourceIndex,
      projectile.headingDegrees,
    ]));
    const shared = [...leftBySource.keys()].filter((sourceIndex) => rightBySource.has(sourceIndex));
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.some((sourceIndex) =>
      Math.abs((leftBySource.get(sourceIndex) ?? 0) - (rightBySource.get(sourceIndex) ?? 0)) > 1e-8))
      .toBe(true);
    expect(() => new CanonicalCombatKernel({...OPTIONS, initialPlayerPosition: {x: -1, y: 570}}))
      .toThrow(/logical viewport/);
  });

  it("reads negative aim lead from the exact historical player tick", () => {
    const stationary = new CanonicalCombatKernel(optionsFor("room.information.unanswered_fan"));
    const returned = new CanonicalCombatKernel(optionsFor("room.information.unanswered_fan"));
    for (let tick120 = 1; tick120 <= 155; tick120 += 1) {
      stationary.step({...inputAt(tick120), focused: false});
      returned.step({
        ...inputAt(tick120),
        focused: false,
        movement: tick120 >= 136 && tick120 <= 144
          ? {x: 1, y: 0}
          : tick120 >= 145 && tick120 <= 153
            ? {x: -1, y: 0}
            : {x: 0, y: 0},
      });
    }
    expect(returned.snapshot().playerPosition).toEqual(stationary.snapshot().playerPosition);
    const lateHeadings = (kernel: CanonicalCombatKernel) => new Map(
      kernel.snapshot().projectiles
        .filter((projectile) => projectile.sourceId === "late-echo")
        .map((projectile) => [projectile.sourceIndex, projectile.headingDegrees]),
    );
    const stationaryHeadings = lateHeadings(stationary);
    const returnedHeadings = lateHeadings(returned);
    const shared = [...stationaryHeadings.keys()].filter((sourceIndex) => returnedHeadings.has(sourceIndex));
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.some((sourceIndex) => Math.abs(
      (stationaryHeadings.get(sourceIndex) ?? 0) - (returnedHeadings.get(sourceIndex) ?? 0),
    ) > 1e-8)).toBe(true);
  });

  it("replays one resolved seed to an identical frozen snapshot and canonical event trace", () => {
    const first = runTo(1400);
    const second = runTo(1400);

    expect(first.canonicalEventSerialization()).toBe(second.canonicalEventSerialization());
    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.events().length).toBeGreaterThan(300);
    expect(Object.isFrozen(first.snapshot())).toBe(true);
    expect(Object.isFrozen(first.snapshot().projectiles)).toBe(true);
    expect(first.snapshot().adapterGaps).toEqual({
      grazeRadiusPx: 18,
      projectileDamage: 1,
      projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
      targetHistorySampling: "exact-crossed-tick120",
      positiveAimLeadPolicy: "last-authoritative-segment-linear-extrapolation",
      lateralWallLaneProjection: "candidate-center-into-left-to-right-lane-bins",
      provenance: "application-required-v4-omission",
    });
  });

  it("produces one trace across 30 Hz, 144 Hz, and a capped large render delta", () => {
    const durationMs = 1400 * 1000 / 120;
    const at30Hz = driveWithDeltas(Array.from({length: 350}, () => 1000 / 30));
    const at144Hz = driveWithDeltas(Array.from({length: 1680}, () => 1000 / 144));
    const largeDelta = driveWithDeltas([durationMs]);

    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(largeDelta.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(largeDelta.snapshot()).toEqual(at30Hz.snapshot());
  });

  it("orders same-tick collision-off before one stable damage commit for competing hits", () => {
    const kernel = new CanonicalCombatKernel({...OPTIONS, seed: 99, difficulty: "HARD"});
    for (let tick120 = 1; tick120 <= 732; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    const events = kernel.events().filter((event) => event.tick120 === 732);
    const impacts = events.filter((event) => event.id === "projectile.impact.commit");
    const damage = events.filter((event) => event.id === "player.damage.commit");
    const batch = kernel.snapshot().lastDamageBatch;

    expect(batch?.tick120).toBe(732);
    expect(batch?.hits.length).toBeGreaterThan(1);
    expect(batch?.hits.filter((hit) => hit.disposition === "committed")).toHaveLength(1);
    expect(batch?.hits.filter((hit) => hit.disposition === "competing").length).toBe(
      (batch?.hits.length ?? 1) - 1,
    );
    expect(impacts).toHaveLength(1);
    expect(damage).toHaveLength(1);
    expect(events[0]?.phasePriority).toBe(0);
    expect(events.findIndex((event) => event.id === "player.damage.commit"))
      .toBeGreaterThan(events.findIndex((event) => event.id === "projectile.collision.off"));
    expect(events.some((event) => event.id === "player.collision.on")).toBe(false);
    expect(kernel.snapshot().player.health).toBe(1);
  });

  it("holds movement, Focus, and Override throughout death and respawn", () => {
    const kernel = new CanonicalCombatKernel({
      ...OPTIONS,
      seed: 99,
      difficulty: "HARD",
      projectileDamage: 3,
    });
    for (let tick120 = 1; tick120 <= 732; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
    }
    const dead = kernel.snapshot();
    expect(dead.player.state).toBe("dead");
    const heldPosition = dead.playerPosition;
    const resumeAtTick120 = dead.player.respawnCompleteAtTick120;
    expect(resumeAtTick120).not.toBeNull();

    for (let tick120 = 733; tick120 < (resumeAtTick120 ?? 733); tick120 += 1) {
      const held = kernel.step({
        tick120,
        movement: {x: 1, y: 0},
        focused: true,
        ...(tick120 === 733
          ? {overridePressed: true, overrideDirection: {x: 0, y: -1}}
          : {}),
      });
      expect(held.playerPosition).toEqual(heldPosition);
    }
    expect(kernel.snapshot()).toMatchObject({
      playerPosition: heldPosition,
      player: {state: "respawning"},
      override: {state: "idle", cycle: 0, deadlineTick120: null},
    });
    expect(kernel.events().some((event) => event.id === "player.override.charge.begin")).toBe(false);

    const resumed = kernel.step({
      tick120: resumeAtTick120 as number,
      movement: {x: 1, y: 0},
      focused: true,
    });
    expect(resumed.player.state).toBe("alive");
    expect(resumed.playerPosition.x).toBeCloseTo(
      heldPosition.x + PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND / 120,
      12,
    );
  });

  it("cancels live flight at pattern end and drains entity-owned residue later", () => {
    const kernel = runTo(1032);
    const atPatternEnd = kernel.snapshot();

    expect(atPatternEnd.patternComplete).toBe(true);
    expect(atPatternEnd.projectileLifecycleDrained).toBe(false);
    expect(atPatternEnd.handoffReady).toBe(false);
    expect(atPatternEnd.projectiles.length).toBeGreaterThan(0);
    expect(atPatternEnd.projectiles.every((projectile) => projectile.state === "residue")).toBe(true);
    expect(kernel.events().filter((event) =>
      event.tick120 === 1032 && event.id === "projectile.cancel.commit").length).toBeGreaterThan(0);

    for (let tick120 = 1033; tick120 <= 1400; tick120 += 1) {
      kernel.step(inputAt(tick120));
    }
    expect(kernel.snapshot()).toMatchObject({
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
    });
    expect(kernel.events().some((event) => event.id === "projectile.lifecycle.complete")).toBe(true);
  });

  it("does not call handoff ready while an owned Override deadline is pending", () => {
    const kernel = runTo(1400);
    expect(kernel.snapshot()).toMatchObject({
      projectileLifecycleDrained: true,
      handoffReady: true,
      override: {state: "idle"},
    });

    const charging = kernel.step({
      ...inputAt(1401),
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    });
    expect(charging).toMatchObject({
      projectileLifecycleDrained: true,
      handoffReady: false,
      override: {state: "charging", deadlineTick120: 1474},
    });

    for (let tick120 = 1402; tick120 <= 1474; tick120 += 1) kernel.step(inputAt(tick120));
    expect(kernel.snapshot()).toMatchObject({
      handoffReady: true,
      override: {state: "idle", deadlineTick120: null},
    });
  });

  it("swept-cancels projectiles entering an active Override before player contact", () => {
    const kernel = new CanonicalCombatKernel({
      ...OPTIONS,
      seed: 1,
      difficulty: "HARD",
      grazeRadiusPx: 1000,
    });
    for (let tick120 = 1; tick120 <= 591; tick120 += 1) {
      kernel.step({
        ...inputAt(tick120),
        ...(tick120 === 500
          ? {overridePressed: true, overrideDirection: {x: 0, y: -1}}
          : {}),
      });
    }
    const snapshot = kernel.snapshot();
    const localVoid = snapshot.override.localVoid;
    expect(snapshot.override.state).toBe("active");
    expect(localVoid).not.toBeNull();
    const collidersInside = snapshot.projectiles.filter((projectile) => {
      if (localVoid === null || projectile.state !== "flight" || !projectile.collisionEnabled) return false;
      const dx = projectile.position.x - localVoid.origin.x;
      const dy = projectile.position.y - localVoid.origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance > localVoid.radius) return false;
      if (distance <= Number.EPSILON) return true;
      const alignment = dx / distance * localVoid.direction.x + dy / distance * localVoid.direction.y;
      return alignment + Number.EPSILON
        >= Math.cos(localVoid.halfAngleDegrees * Math.PI / 180);
    });
    expect(collidersInside).toEqual([]);
    expect(kernel.events().filter((event) =>
      event.tick120 === 591
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "override_void")).toHaveLength(3);
  });

  it("does not replay the prior tick sweep when Override first opens", () => {
    const kernel = new CanonicalCombatKernel({
      ...OPTIONS,
      seed: 1,
      difficulty: "HARD",
      grazeRadiusPx: 1000,
    });
    for (let tick120 = 1; tick120 <= 572; tick120 += 1) {
      kernel.step({
        ...inputAt(tick120),
        focused: true,
        ...(tick120 === 500
          ? {
            overridePressed: true,
            overrideDirection: {x: 0.4756242091, y: -0.8796485729},
          }
          : {}),
      });
    }
    const stableId = "combat:common.eye_acquisition/micro/0008";
    expect(kernel.events().some((event) =>
      event.tick120 === 572
      && event.id === "projectile.cancel.commit"
      && event.entityStableId === stableId)).toBe(false);
    expect(kernel.snapshot().projectiles.find((projectile) => projectile.instanceId === stableId))
      .toMatchObject({state: "flight", collisionEnabled: true, movedAtTick120: 572});
  });

  it("rejects skipped or repeated master ticks", () => {
    const kernel = new CanonicalCombatKernel(OPTIONS);
    expect(() => kernel.step(inputAt(2))).toThrow(/one tick at a time/);
    kernel.step(inputAt(1));
    expect(() => kernel.step(inputAt(1))).toThrow(/one tick at a time/);
  });

  it("rejects a malformed input transaction without consuming its tick", () => {
    const kernel = new CanonicalCombatKernel(OPTIONS);
    const before = kernel.snapshot();
    const beforeEvents = kernel.canonicalEventSerialization();

    expect(() => kernel.step({
      ...inputAt(1),
      overridePressed: true,
      overrideDirection: {x: 0, y: 0},
    })).toThrow(/overrideDirection must be non-zero/);
    expect(kernel.snapshot()).toEqual(before);
    expect(kernel.canonicalEventSerialization()).toBe(beforeEvents);

    expect(() => kernel.step({...inputAt(1), movement: {x: 2, y: 0}}))
      .toThrow(/movement magnitude/);
    expect(kernel.snapshot()).toEqual(before);
    let getterReads = 0;
    const accessorMovement = {
      get x(): number {
        getterReads += 1;
        return getterReads === 1 ? 0 : Number.NaN;
      },
      y: 0,
    };
    expect(() => kernel.step({...inputAt(1), movement: accessorMovement}))
      .toThrow(/own data coordinates/);
    expect(getterReads).toBe(0);
    expect(kernel.snapshot()).toEqual(before);
    let focusedReads = 0;
    const accessorFocused = {
      tick120: 1,
      movement: {x: 1, y: 0},
      get focused(): boolean {
        focusedReads += 1;
        return focusedReads > 2;
      },
    } as CanonicalCombatStepInput;
    expect(() => kernel.step(accessorFocused)).toThrow(/input\.focused must be an own data property/);
    expect(focusedReads).toBe(0);
    expect(kernel.snapshot()).toEqual(before);
    let overrideReads = 0;
    const accessorOverride = {
      ...inputAt(1),
      get overridePressed(): boolean {
        overrideReads += 1;
        return true;
      },
    } as CanonicalCombatStepInput;
    expect(() => kernel.step(accessorOverride))
      .toThrow(/input\.overridePressed must be an own data property/);
    expect(overrideReads).toBe(0);
    expect(kernel.snapshot()).toEqual(before);
    kernel.step(inputAt(1));
    expect(kernel.snapshot().tick120).toBe(1);
  });

  it("owns player integration at the exact V4 oracle movement envelope", () => {
    const focus = new CanonicalCombatKernel(OPTIONS);
    const focusStep = PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND / 120;
    focus.step({
      tick120: 1,
      movement: {x: 1, y: 0},
      focused: true,
    });
    expect(focus.snapshot().playerPosition.x).toBeCloseTo(180 + focusStep, 12);

    const normal = new CanonicalCombatKernel(OPTIONS);
    const normalStep = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
    for (let tick120 = 1; tick120 <= 75; tick120 += 1) {
      normal.step({
        tick120,
        movement: {x: 1, y: 0},
        focused: false,
      });
    }
    expect(normal.snapshot().playerPosition.x).toBeCloseTo(180 + normalStep * 75, 10);
  });

  it("keeps the manifest contract deeply immutable and outside gameplay write-back", () => {
    const kernel = new CanonicalCombatKernel(OPTIONS);
    const contract = kernel.patternContractSnapshot();
    const motionParams = contract.emitters[0]?.motionStack[0]?.params;

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.safeGap)).toBe(true);
    expect(Object.isFrozen(contract.safeGap.path)).toBe(true);
    expect(Object.isFrozen(contract.emitters)).toBe(true);
    expect(Object.isFrozen(motionParams)).toBe(true);
    expect(() => {
      (contract.safeGap.path as {centerX: number}).centerX = 0;
    }).toThrow(TypeError);

    const reference = new CanonicalCombatKernel(OPTIONS);
    for (let tick120 = 1; tick120 <= 200; tick120 += 1) {
      kernel.step(inputAt(tick120));
      reference.step(inputAt(tick120));
    }
    expect(kernel.canonicalEventSerialization()).toBe(reference.canonicalEventSerialization());
  });

  it("sweeps projectile and player motion relative to one another", () => {
    const crossing = sweepMovingProjectileAgainstPlayer(
      {x: 0, y: 100},
      {x: 100, y: 100},
      2,
      {x: 100, y: 100},
      {x: 0, y: 100},
      3,
    );
    expect(crossing?.timeOfImpact).toBeCloseTo(0.475, 8);

    expect(sweepMovingProjectileAgainstPlayer(
      {x: 0, y: 0},
      {x: 10, y: 0},
      2,
      {x: 100, y: 100},
      {x: 90, y: 100},
      3,
    )).toBeNull();
  });
});

describe("isolated Dusk settle combat capability", () => {
  it("pins the immutable transition pattern and layered V4 oracle evidence", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("transition.dusk_settle"),
      seed: DUSK_SETTLE_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateDuskSettlePatternContract(contract)).not.toThrow();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract).toMatchObject({
      id: "transition.dusk_settle",
      category: "TRANSITION",
      room: "TRANSITION",
      durationMs: 8200,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 554, event: "collision.arm"},
        {atMs: 554, event: "emit.begin"},
        {atMs: 4100, event: "pattern.midpoint"},
        {atMs: 7500, event: "emit.end"},
        {atMs: 7780, event: "residue.commit"},
        {atMs: 8200, event: "pattern.complete"},
      ],
      emitters: [{
        id: "settling-field",
        kind: "projectile",
        anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
        geometry: {
          type: "grid",
          variant: "decreasing-density",
          count: 12,
          baseAngleDeg: 90,
          spreadDeg: 0,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 554, intervalMs: 860, bursts: 7, intraBurstMs: 0},
        projectile: {archetype: "bullet.micro.notch_e", collisionRadiusPx: 2, armDelayMs: 40},
        speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 112}]},
        motionStack: [
          {
            operator: "op.speed_envelope",
            params: {
              keys: [
                {atMs: 0, multiplier: 1},
                {atMs: 1200, multiplier: 0.42},
                {atMs: 2100, multiplier: 0},
              ],
              interpolation: "linear",
            },
          },
          {operator: "op.linear", params: {}},
        ],
      }],
      safeGap: {
        type: "settling_center",
        minimumWidthPx: 54,
        focusMinimumWidthPx: 46,
        enforcement: "rule_clip_with_residue",
        path: {
          centerX: 180,
          amplitudePx: 12,
          periodMs: 8000,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        readability: {leadMs: 520, neverColorOnly: true},
      },
      warning: {
        durationMs: 554,
        shape: "descending_settlement_band",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      residue: {
        type: "dusk_sediment",
        lifetimeMs: 3424,
        density: 0.38,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      seed: {
        algorithm: "mulberry32-v1",
        base: 924052336,
        composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
        randomCalls: "emitter-order then burst-order then projectile-order",
      },
      resolutionHook: "snapshot_capture_ready",
    });
    expect("laserGeometry" in contract).toBe(false);
    expect(kernel.events()).toEqual([]);

    const expected = {
      EASY: {
        emissions: 7,
        candidates: 63,
        interventions: 0,
        hash: "216fcd54ba5b35eb60786f245a17fdc9445695f064e77cda8bce69739bc2469a",
      },
      NORMAL: {
        emissions: 7,
        candidates: 84,
        interventions: 0,
        hash: "18e63cdf2b880d71a5dd3f84680464d2d047e14bf7a144357e5024925a846298",
      },
      HARD: {
        emissions: 7,
        candidates: 98,
        interventions: 0,
        hash: "5c88aa2503048653ded017733a829f94deb3516165cb0a202101602808824988",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: DUSK_SETTLE_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: DUSK_SETTLE_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      const projection = (trace: typeof reference) => ({
        emissions: trace.events.length,
        candidates: trace.events.reduce((total, event) => total + event.count, 0),
        interventions: trace.omittedOrRedirected,
        hash: trace.traceSha256,
      });
      expect(projection(reference)).toEqual(expected[difficulty]);
      expect(projection(declared)).toEqual(expected[difficulty]);
    }
  });

  it("fails closed on Dusk hook, envelope, geometry, and hostile record drift", () => {
    const source = structuredClone(executablePattern("transition.dusk_settle")) as unknown as {
      category: string;
      resolutionHook: string;
      emitters: Array<{
        geometry: {variant: string};
        motionStack: Array<{operator: string; params: {interpolation?: string; keys?: Array<{multiplier: number}>}}>;
      }>;
    };
    const hookDrift = structuredClone(source);
    hookDrift.resolutionHook = "snapshot.complete";
    expect(() => validateDuskSettlePatternContract(hookDrift)).toThrow(/authored contract drifted/);
    const categoryDrift = structuredClone(source);
    categoryDrift.category = "ROOM";
    expect(() => validateDuskSettlePatternContract(categoryDrift)).toThrow(/authored contract drifted/);
    const interpolationDrift = structuredClone(source);
    const envelope = interpolationDrift.emitters[0]?.motionStack[0]?.params;
    if (envelope === undefined) throw new Error("Dusk envelope fixture is missing");
    envelope.interpolation = "step";
    expect(() => validateDuskSettlePatternContract(interpolationDrift)).toThrow(/settling-field contract drifted/);
    const keyDrift = structuredClone(source);
    const middleKey = keyDrift.emitters[0]?.motionStack[0]?.params.keys?.[1];
    if (middleKey === undefined) throw new Error("Dusk middle key fixture is missing");
    middleKey.multiplier = 0.43;
    expect(() => validateDuskSettlePatternContract(keyDrift)).toThrow(/settling-field contract drifted/);
    const orderDrift = structuredClone(source);
    const first = orderDrift.emitters[0]?.motionStack[0];
    const second = orderDrift.emitters[0]?.motionStack[1];
    if (first === undefined || second === undefined) throw new Error("Dusk motion fixture is missing");
    orderDrift.emitters[0]!.motionStack = [second, first];
    expect(() => validateDuskSettlePatternContract(orderDrift)).toThrow(/declaration order drifted/);
    const geometryDrift = structuredClone(source);
    geometryDrift.emitters[0]!.geometry.variant = "generic-grid";
    expect(() => validateDuskSettlePatternContract(geometryDrift)).toThrow(/settling-field contract drifted/);

    let hookReads = 0;
    const accessorHook = Object.defineProperty(structuredClone(source), "resolutionHook", {
      enumerable: true,
      get() {
        hookReads += 1;
        return "snapshot_capture_ready";
      },
    });
    expect(() => validateDuskSettlePatternContract(accessorHook)).toThrow(/own data property/);
    expect(hookReads).toBe(0);
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("transition.dusk_settle"),
      roomId: "TRANSITION",
    })).toThrow(/not authored/);
  });

  it("keeps exact Dusk cadence, arm crossings, and analytic linear settling", () => {
    const pattern = executablePattern("transition.dusk_settle");
    const expected = {
      EASY: {
        count: 9,
        spawn: [67, 187, 306, 426, 546, 666, 785],
        arm: [72, 191, 311, 431, 551, 670, 790],
      },
      NORMAL: {
        count: 12,
        spawn: [67, 170, 273, 377, 480, 583, 686],
        arm: [72, 175, 278, 381, 485, 588, 691],
      },
      HARD: {
        count: 14,
        spawn: [67, 158, 249, 339, 430, 521, 612],
        arm: [72, 163, 253, 344, 435, 526, 617],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(roundPatternCount(
        pattern.emitters[0]!.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      )).toBe(expected[difficulty].count);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(expected[difficulty].spawn);
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expected[difficulty].arm);
    }

    const kernel = new CanonicalCombatKernel({
      ...optionsFor("transition.dusk_settle"),
      seed: DUSK_SETTLE_REPORT_SEED,
    });
    const projectile = () => {
      const candidate = kernel.snapshot().projectiles.find((entry) =>
        entry.sourceId === "settling-field"
        && entry.burstIndex === 0
        && entry.sourceIndex === 0);
      expect(candidate).toBeDefined();
      return candidate as NonNullable<typeof candidate>;
    };
    const stepTo = (targetTick120: number): void => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    stepTo(67);
    expect(projectile()).toMatchObject({
      state: "arm",
      spawnedAtTick: 67,
      armAtTick: 72,
      position: {y: 102.4},
      headingDegrees: 90,
      speedPxPerSecond: 112,
      collisionEnabled: false,
    });
    const initialX = projectile().position.x;
    stepTo(72);
    expect(projectile()).toMatchObject({
      state: "flight",
      position: {x: initialX, y: 102.4},
      speedPxPerSecond: 112,
      collisionEnabled: true,
    });

    const envelopeIntegralSeconds = (fromAgeMs: number, toAgeMs: number): number => {
      const clampedFrom = Math.max(0, Math.min(2100, fromAgeMs));
      const clampedTo = Math.max(clampedFrom, Math.min(2100, toAgeMs));
      const integrateLinear = (
        fromMs: number,
        toMs: number,
        leftMs: number,
        rightMs: number,
        leftValue: number,
        rightValue: number,
      ): number => {
        const startValue = leftValue
          + (rightValue - leftValue) * (fromMs - leftMs) / (rightMs - leftMs);
        const endValue = leftValue
          + (rightValue - leftValue) * (toMs - leftMs) / (rightMs - leftMs);
        return (startValue + endValue) / 2 * (toMs - fromMs) / 1000;
      };
      let total = 0;
      if (clampedFrom < 1200) {
        total += integrateLinear(clampedFrom, Math.min(clampedTo, 1200), 0, 1200, 1, 0.42);
      }
      if (clampedTo > 1200) {
        total += integrateLinear(Math.max(clampedFrom, 1200), clampedTo, 1200, 2100, 0.42, 0);
      }
      return total;
    };
    for (const tick120 of [73, 210, 211, 318, 319, 360] as const) {
      stepTo(tick120);
      const ageMs = tick120 * 1000 / 120 - 554;
      const expectedDistance = 112 * envelopeIntegralSeconds(46, ageMs);
      expect(projectile().position.x).toBeCloseTo(initialX, 11);
      expect(projectile().position.y).toBeCloseTo(102.4 + expectedDistance, 11);
      const expectedMultiplier = ageMs <= 1200
        ? 1 + (0.42 - 1) * ageMs / 1200
        : ageMs <= 2100
          ? 0.42 * (2100 - ageMs) / 900
          : 0;
      expect(projectile().speedPxPerSecond).toBeCloseTo(112 * expectedMultiplier, 11);
      expect(projectile().collisionEnabled).toBe(true);
    }
    expect(projectile().position.y).toBeLessThan(476);
  });

  it("keeps Dusk motion, lifecycle, and events relative to a nonzero occurrence start", () => {
    const patternId = "transition.dusk_settle" as const;
    const startOffsetTick120 = 401;
    const relativeTargetTick120 = 420;
    const atZero = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: DUSK_SETTLE_REPORT_SEED,
    });
    const atOffset = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: DUSK_SETTLE_REPORT_SEED,
      startTick120: startOffsetTick120,
    });
    for (let relativeTick120 = 1;
      relativeTick120 <= relativeTargetTick120;
      relativeTick120 += 1) {
      const sample = {movement: {x: 0, y: 0}, focused: false} as const;
      atZero.step({tick120: relativeTick120, ...sample});
      atOffset.step({tick120: startOffsetTick120 + relativeTick120, ...sample});
    }

    expect(atZero.snapshot().relativeTick120).toBe(relativeTargetTick120);
    expect(atOffset.snapshot().relativeTick120).toBe(relativeTargetTick120);
    const relativeProjectiles = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - startTick120,
        spawnedAtTick: projectile.spawnedAtTick - startTick120,
        armAtTick: projectile.armAtTick - startTick120,
      }));
    expect(relativeProjectiles(atOffset, startOffsetTick120)).toEqual(
      relativeProjectiles(atZero, 0),
    );

    const relativeMilliseconds = (value: number, startTick120: number): number =>
      Math.round((value - startTick120 * 1000 / 120) * 1_000_000_000) / 1_000_000_000;
    const relativeEvents = (kernel: CanonicalCombatKernel, startTick120: number) =>
      kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") {
            payload[key] = relativeMilliseconds(payload[key], startTick120);
          }
        }
        return {
          ...event,
          tick120: event.tick120 - startTick120,
          simulationTimeMs: relativeMilliseconds(event.simulationTimeMs, startTick120),
          payload,
        };
      });
    expect(relativeEvents(atOffset, startOffsetTick120)).toEqual(relativeEvents(atZero, 0));

    for (let relativeTick120 = relativeTargetTick120 + 1;
      relativeTick120 <= 1395;
      relativeTick120 += 1) {
      const sample = {movement: {x: 0, y: 0}, focused: false} as const;
      atZero.step({tick120: relativeTick120, ...sample});
      atOffset.step({tick120: startOffsetTick120 + relativeTick120, ...sample});
    }
    expect(atZero.snapshot()).toMatchObject({
      tick120: 1395,
      relativeTick120: 1395,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
    });
    expect(atOffset.snapshot()).toMatchObject({
      tick120: startOffsetTick120 + 1395,
      relativeTick120: 1395,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
    });
    expect(relativeEvents(atOffset, startOffsetTick120)).toEqual(relativeEvents(atZero, 0));
  });

  it("locks E/N/H production counts and drains Dusk sediment without authoring snapshot events", {
    timeout: 10000,
  }, () => {
    const pattern = executablePattern("transition.dusk_settle");
    const expected = {
      EASY: {
        candidates: 63,
        productionHash: "9867ff2413c15077d0ad7b5d487a65384de3f47be2d11de791f26b8bfe35776a",
      },
      NORMAL: {
        candidates: 84,
        productionHash: "cbc7a1f93f73a9e6a68fa59fd34b4a91923bbcaa4db1c0b4d22ee1b2339797df",
      },
      HARD: {
        candidates: 98,
        productionHash: "97dc90a77e51700d393f90d72ef4988964d4c1a7e89dc8342a876186f5b6289f",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("transition.dusk_settle"),
        seed: DUSK_SETTLE_REPORT_SEED,
        difficulty,
      });
      const candidates = createPatternSchedule(pattern, difficulty).reduce((total, scheduled) =>
        total + roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        ), 0);
      for (let tick120 = 1; tick120 <= 984; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
      const events = kernel.events();
      const count = (id: string, reason?: string): number => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      expect({
        candidates,
        rng: kernel.snapshot().rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        impacts: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        productionHash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        candidates: expected[difficulty].candidates,
        rng: expected[difficulty].candidates,
        spawn: expected[difficulty].candidates,
        sourceWithdrawn: 0,
        outOfBounds: 0,
        patternEnd: expected[difficulty].candidates,
        impacts: 0,
        damage: 0,
        productionHash: expected[difficulty].productionHash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 984,
        patternComplete: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
      });
      expect(kernel.snapshot().projectiles).toHaveLength(expected[difficulty].candidates);
      expect(kernel.snapshot().projectiles.every((projectile) =>
        projectile.state === "residue" && projectile.collisionEnabled === false)).toBe(true);
      expect(events.some((event) => event.id.startsWith("snapshot."))).toBe(false);
      expect(kernel.projectilePoolAudit()).toEqual([]);
    }

    const lifecycle = new CanonicalCombatKernel({
      ...optionsFor("transition.dusk_settle"),
      seed: DUSK_SETTLE_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 1394; tick120 += 1) {
      lifecycle.step({...inputAt(tick120), focused: false});
    }
    expect(crossedTickCount(3424)).toBe(411);
    expect(lifecycle.snapshot()).toMatchObject({
      tick120: 1394,
      patternComplete: true,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(lifecycle.snapshot().projectiles).toHaveLength(84);
    lifecycle.step({...inputAt(1395), focused: false});
    expect(lifecycle.snapshot()).toMatchObject({
      tick120: 1395,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      projectiles: [],
    });
    const finalEvents = lifecycle.events().filter((event) => event.tick120 === 1395);
    expect(finalEvents.filter((event) => event.id === "projectile.residue.remove")).toHaveLength(84);
    expect(finalEvents.filter((event) => event.id === "projectile.lifecycle.complete")).toHaveLength(84);
    expect(lifecycle.events().some((event) => event.id.startsWith("snapshot."))).toBe(false);
  });

  it("keeps Dusk room-neutral and identical across render cadences", () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const at30HzDeltas = Array.from({length: 105}, () => 1000 / 30);
    const baseline = driveDuskSettleWithDeltas(at30HzDeltas, targetTick120, "INFORMATION");
    const cadenceVariants = [
      driveDuskSettleWithDeltas(
        Array.from({length: 210}, () => 1000 / 60),
        targetTick120,
        "INFORMATION",
      ),
      driveDuskSettleWithDeltas(
        Array.from({length: 504}, () => 1000 / 144),
        targetTick120,
        "INFORMATION",
      ),
      driveDuskSettleWithDeltas([durationMs], targetTick120, "INFORMATION"),
    ];
    const roomVariants = ["FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"].map((roomId) =>
      driveDuskSettleWithDeltas(at30HzDeltas, targetTick120, roomId));
    for (const candidate of [...cadenceVariants, ...roomVariants]) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated Crack Fall Loop combat capability", () => {
  it("pins the exact V4 contract and separates immutable Python from declared-V4 QA", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.crack_fall_loop"),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateCrackFallLoopPatternContract(contract)).not.toThrow();
    expect(contract).toMatchObject({
      id: "room.forced.crack_fall_loop",
      category: "ROOM",
      room: "FORCED_ALIGNMENT",
      durationMs: 11000,
      warning: {
        durationMs: 699,
        shape: "mirrored_seam_trajectory",
        coversSweptArea: true,
        collisionEnabled: false,
      },
      safeGap: {
        type: "serpentine_seam",
        minimumWidthPx: 34,
        focusMinimumWidthPx: 26,
        enforcement: "seam_redirect",
        path: {centerX: 180, amplitudePx: 42, periodMs: 7600, maxTravelPxPerSec: 78},
      },
      residue: {type: "seam_filament", lifetimeMs: 3850, gameplayCollision: false},
      seed: {base: 3074675749},
    });
    expect(contract.emitters).toEqual([expect.objectContaining({
      id: "falling-claims",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.11},
      geometry: {
        type: "fan",
        variant: "seam-crossing-wide",
        count: 12,
        baseAngleDeg: 90,
        spreadDeg: 164,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 699, intervalMs: 980, bursts: 10, intraBurstMs: 0},
      projectile: {archetype: "bullet.micro.notch_e", collisionRadiusPx: 2, armDelayMs: 40},
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 162}]},
      motionStack: [
        {operator: "op.linear", params: {}},
        {operator: "op.seam_transform", params: {seamX: 180, mode: "mirror", offsetPx: 0}},
      ],
    })]);
    expect(CRACK_FALL_LOOP_REPORT_SEED).not.toBe(contract.seed.base);

    const expected = {
      EASY: {
        reference: "18563a10dcc0b197fcb8574c9272beb3af9f80252c8491b346176b3d0d88618f",
        declared: "394149b3177cd773d085209d6289012c2c762eb7944e8e3fdad4885bff5f0e63",
        interventions: 72,
      },
      NORMAL: {
        reference: "def23749655a5c2244e89d33436e9ba144a4a5fd06124f2a30aea608e563fc14",
        declared: "248c2faf51fd9d8eb1485286d3478a18c432bb93dccf62c3772e2291e7736911",
        interventions: 49,
      },
      HARD: {
        reference: "4a621d2078a9614f6a6f7bfcb7406d02f82f232693ed50936e824809d609377c",
        declared: "975c6bd18fa42d6c44571616182d65db36fb23d11b33f8423d690e5c08a7458c",
        interventions: 71,
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: CRACK_FALL_LOOP_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: CRACK_FALL_LOOP_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect({
        reference: reference.traceSha256,
        declared: declared.traceSha256,
        referenceEmissions: reference.events.length,
        declaredEmissions: declared.events.length,
        referenceInterventions: reference.omittedOrRedirected,
        declaredInterventions: declared.omittedOrRedirected,
      }).toEqual({
        reference: expected[difficulty].reference,
        declared: expected[difficulty].declared,
        referenceEmissions: 10,
        declaredEmissions: 10,
        referenceInterventions: expected[difficulty].interventions,
        declaredInterventions: expected[difficulty].interventions,
      });
    }
  });

  it("fails closed on topology, redirect, declaration-order, and hostile record drift", () => {
    const source = structuredClone(executablePattern("room.forced.crack_fall_loop")) as unknown as {
      safeGap: {enforcement: string};
      emitters: Array<{motionStack: Array<{operator: string; params: Record<string, unknown>}>}>;
    };
    const redirectDrift = structuredClone(source);
    redirectDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateCrackFallLoopPatternContract(redirectDrift)).toThrow(/authored contract drifted/);
    const orderDrift = structuredClone(source);
    const first = orderDrift.emitters[0]?.motionStack[0];
    const second = orderDrift.emitters[0]?.motionStack[1];
    if (first === undefined || second === undefined) throw new Error("Crack motion fixture is missing");
    orderDrift.emitters[0]!.motionStack = [second, first];
    expect(() => validateCrackFallLoopPatternContract(orderDrift)).toThrow(/declaration order drifted/);
    const modeDrift = structuredClone(source);
    modeDrift.emitters[0]!.motionStack[1]!.params.mode = "offset";
    expect(() => validateCrackFallLoopPatternContract(modeDrift))
      .toThrow(/falling-claims contract drifted/);
    expect(() => validateSeamTransformParameters({seamX: 180, mode: "mirror", offsetPx: 0}))
      .not.toThrow();
    expect(() => validateSeamTransformParameters({seamX: 180, mode: "swap_velocity", offsetPx: 0}))
      .toThrow(/admitted mirror or offset topology/);

    let seamReads = 0;
    const accessorParams = Object.defineProperty({mode: "mirror", offsetPx: 0}, "seamX", {
      enumerable: true,
      get() {
        seamReads += 1;
        return 180;
      },
    });
    expect(() => validateSeamTransformParameters(accessorParams)).toThrow(/own data property/);
    expect(seamReads).toBe(0);
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("room.forced.crack_fall_loop"),
      roomId: "INFORMATION",
    })).toThrow(/room mismatch/);
  });

  it("keeps exact cadence, stationary arm, one inclusive departure transform, and nonzero-start parity", () => {
    const pattern = executablePattern("room.forced.crack_fall_loop");
    const expected = {
      EASY: {
        count: 9,
        spawn: [84, 221, 357, 494, 630, 766, 903, 1039, 1176, 1312],
        arm: [89, 226, 362, 498, 635, 771, 908, 1044, 1181, 1317],
      },
      NORMAL: {
        count: 12,
        spawn: [84, 202, 320, 437, 555, 672, 790, 908, 1025, 1143],
        arm: [89, 207, 324, 442, 560, 677, 795, 912, 1030, 1148],
      },
      HARD: {
        count: 14,
        spawn: [84, 188, 291, 395, 498, 602, 705, 809, 912, 1016],
        arm: [89, 193, 296, 400, 503, 607, 710, 814, 917, 1021],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(roundPatternCount(
        pattern.emitters[0]!.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      )).toBe(expected[difficulty].count);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(expected[difficulty].spawn);
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expected[difficulty].arm);
    }

    const driveTo = (kernel: CanonicalCombatKernel, targetRelativeTick120: number) => {
      for (let relativeTick120 = kernel.snapshot().relativeTick120 + 1;
        relativeTick120 <= targetRelativeTick120;
        relativeTick120 += 1) {
        kernel.step({
          tick120: kernel.snapshot().startTick120 + relativeTick120,
          movement: {x: 0, y: 0},
          focused: false,
        });
      }
    };
    const zero = new CanonicalCombatKernel({
      ...optionsFor("room.forced.crack_fall_loop"),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
    });
    driveTo(zero, 84);
    const atSpawn = zero.snapshot().projectiles.find((entry) =>
      entry.burstIndex === 0 && entry.sourceIndex === 0);
    expect(atSpawn).toMatchObject({
      state: "arm",
      position: {x: 180, y: 70.4},
      spawnedAtTick: 84,
      armAtTick: 89,
      collisionEnabled: false,
      movedAtTick120: null,
    });
    driveTo(zero, 89);
    const atArm = zero.snapshot().projectiles.find((entry) =>
      entry.burstIndex === 0 && entry.sourceIndex === 0);
    expect(atArm?.position).toEqual(atSpawn?.position);
    expect(atArm).toMatchObject({state: "flight", collisionEnabled: true, movedAtTick120: null});
    const authoredHeading = atArm?.headingDegrees;
    expect(authoredHeading).toBeDefined();
    driveTo(zero, 90);
    const firstFlight = zero.snapshot().projectiles.find((entry) =>
      entry.burstIndex === 0 && entry.sourceIndex === 0);
    expect(firstFlight?.position.x).toBeLessThan(180);
    expect(firstFlight?.headingDegrees).toBeCloseTo(180 - (authoredHeading ?? 0), 12);
    const transformedHeading = firstFlight?.headingDegrees;
    driveTo(zero, 91);
    const secondFlight = zero.snapshot().projectiles.find((entry) =>
      entry.burstIndex === 0 && entry.sourceIndex === 0);
    expect(secondFlight?.position.x).toBeLessThan(firstFlight?.position.x ?? 0);
    expect(secondFlight?.headingDegrees).toBeCloseTo(transformedHeading ?? 0, 12);
    expect(zero.events().some((event) => event.id.includes("seam"))).toBe(false);

    const offsetStart = 401;
    const offset = new CanonicalCombatKernel({
      ...optionsFor("room.forced.crack_fall_loop"),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
      startTick120: offsetStart,
    });
    driveTo(offset, 91);
    const relativeProjectiles = (kernel: CanonicalCombatKernel) => kernel.snapshot().projectiles
      .map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - kernel.snapshot().startTick120,
        armAtTick: projectile.armAtTick - kernel.snapshot().startTick120,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - kernel.snapshot().startTick120,
      }));
    expect(relativeProjectiles(offset)).toEqual(relativeProjectiles(zero));
  });

  it("keeps motion, events, and full lifecycle relative to a nonzero occurrence start", {
    timeout: 10000,
  }, () => {
    const patternId = "room.forced.crack_fall_loop" as const;
    const pattern = executablePattern(patternId);
    const offsetTick120 = 401;
    const zero = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number): void => {
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120: kernel.snapshot().startTick120 + relativeTick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    };
    const relativeMilliseconds = (value: number, startTick120: number): number =>
      Math.round((value - startTick120 * 1000 / 120) * 1_000_000_000) / 1_000_000_000;
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const startTick120 = kernel.snapshot().startTick120;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") {
            payload[key] = relativeMilliseconds(payload[key], startTick120);
          }
        }
        return {
          ...event,
          tick120: event.tick120 - startTick120,
          simulationTimeMs: relativeMilliseconds(event.simulationTimeMs, startTick120),
          payload,
        };
      });
    };
    const normalizedSnapshot = (kernel: CanonicalCombatKernel) => {
      const snapshot = kernel.snapshot();
      const normalizeTick = (value: number | null): number | null =>
        value === null ? null : value - snapshot.startTick120;
      return {
        ...snapshot,
        startTick120: 0,
        tick120: snapshot.relativeTick120,
        player: {
          ...snapshot.player,
          tick120: snapshot.player.tick120 - snapshot.startTick120,
          recoveryAtTick120: normalizeTick(snapshot.player.recoveryAtTick120),
          respawnPlaceAtTick120: normalizeTick(snapshot.player.respawnPlaceAtTick120),
          respawnCompleteAtTick120: normalizeTick(snapshot.player.respawnCompleteAtTick120),
        },
        override: {
          ...snapshot.override,
          tick120: snapshot.override.tick120 - snapshot.startTick120,
          deadlineTick120: normalizeTick(snapshot.override.deadlineTick120),
        },
        projectiles: snapshot.projectiles.map((projectile) => ({
          ...projectile,
          spawnedAtTick: projectile.spawnedAtTick - snapshot.startTick120,
          armAtTick: projectile.armAtTick - snapshot.startTick120,
          movedAtTick120: normalizeTick(projectile.movedAtTick120),
        })),
      };
    };
    for (let relativeTick120 = 1; relativeTick120 <= 1320; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    expect(normalizedSnapshot(offset)).toEqual(normalizedSnapshot(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    for (let relativeTick120 = 1321; relativeTick120 <= 1782; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    expect(normalizedSnapshot(offset)).toEqual(normalizedSnapshot(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot()).toMatchObject({
      tick120: offsetTick120 + 1782,
      relativeTick120: 1782,
      projectiles: [],
      projectileLifecycleDrained: true,
      handoffReady: true,
    });
  });

  it("retains every E/N/H identity, protects the moving corridor, and drains at tick 1782", {
    timeout: 15000,
  }, () => {
    const pattern = executablePattern("room.forced.crack_fall_loop");
    const expected = {
      EASY: {
        candidates: 90,
        outOfBounds: 59,
        patternEnd: 31,
        residuesAtComplete: 62,
        redirects: {left: 49, right: 49},
        hash: "7b3e9adcc1b71329e5df851949d376a3f02cc19b51613e9648429af61d6496b8",
      },
      NORMAL: {
        candidates: 120,
        outOfBounds: 96,
        patternEnd: 24,
        residuesAtComplete: 72,
        redirects: {left: 25, right: 24},
        hash: "22af3f70c7f67589db56e98ac7fc4a3f4e2f1d4c0d1dd212fbf4b73ad4d1ac48",
      },
      HARD: {
        candidates: 140,
        outOfBounds: 128,
        patternEnd: 12,
        residuesAtComplete: 73,
        redirects: {left: 1, right: 72},
        hash: "2ca79d498e7b0a53a51993ec23974a652f726d50f137011695fd0c807289a2f4",
      },
    } as const;
    let easy: CanonicalCombatKernel | null = null;
    let normal: CanonicalCombatKernel | null = null;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.forced.crack_fall_loop"),
        seed: CRACK_FALL_LOOP_REPORT_SEED,
        difficulty,
      });
      const candidates = createPatternSchedule(pattern, difficulty).reduce((total, scheduled) =>
        total + roundPatternCount(
          scheduled.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        ), 0);
      let leftRedirects = 0;
      let rightRedirects = 0;
      for (let tick120 = 1; tick120 <= 1320; tick120 += 1) {
        const priorHeadings = new Map(kernel.snapshot().projectiles
          .filter((projectile) => projectile.state === "flight")
          .map((projectile) => [
            `${projectile.instanceId}:${projectile.generation}`,
            projectile.headingDegrees,
          ]));
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        for (const projectile of kernel.snapshot().projectiles) {
          if (projectile.state !== "flight") continue;
          const prior = priorHeadings.get(`${projectile.instanceId}:${projectile.generation}`);
          if (prior === undefined) continue;
          const delta = projectile.headingDegrees - prior;
          if (Math.abs(delta + 8) < 1e-10) leftRedirects += 1;
          if (Math.abs(delta - 8) < 1e-10) rightRedirects += 1;
        }
      }
      const events = kernel.events();
      const count = (id: string, reason?: string): number => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      expect({
        candidates,
        rng: kernel.snapshot().rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        impact: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        residuesAtComplete: kernel.snapshot().projectiles.length,
        redirects: {left: leftRedirects, right: rightRedirects},
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        candidates: expected[difficulty].candidates,
        rng: expected[difficulty].candidates,
        spawn: expected[difficulty].candidates,
        sourceWithdrawn: 0,
        outOfBounds: expected[difficulty].outOfBounds,
        patternEnd: expected[difficulty].patternEnd,
        impact: 0,
        damage: 0,
        residuesAtComplete: expected[difficulty].residuesAtComplete,
        redirects: expected[difficulty].redirects,
        hash: expected[difficulty].hash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1320,
        patternComplete: true,
        digitalBodiesDrained: true,
        projectileLifecycleDrained: false,
        materialResidueDraining: true,
      });
      expect(kernel.projectilePoolAudit()).toEqual([]);
      if (difficulty === "EASY") easy = kernel;
      if (difficulty === "NORMAL") normal = kernel;
    }
    expect(normal).not.toBeNull();
    if (normal === null) return;
    for (let tick120 = 1321; tick120 <= 1781; tick120 += 1) {
      normal.step(safeGapFollowingInput(normal, pattern, tick120));
    }
    expect(normal.snapshot()).toMatchObject({
      tick120: 1781,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    expect(normal.snapshot().projectiles).toHaveLength(24);
    normal.step(safeGapFollowingInput(normal, pattern, 1782));
    expect(normal.snapshot()).toMatchObject({
      tick120: 1782,
      projectiles: [],
      projectileLifecycleDrained: true,
      handoffReady: true,
    });
    expect(normal.events().filter((event) =>
      event.tick120 === 1782 && event.id === "projectile.residue.remove")).toHaveLength(24);

    expect(easy).not.toBeNull();
    if (easy === null) return;
    const lateIds = easy.events().filter((event) =>
      event.tick120 === 1312 && event.id === "projectile.spawn.commit")
      .map((event) => event.entityStableId);
    expect(lateIds).toHaveLength(9);
    expect(easy.events().filter((event) =>
      event.tick120 === 1317
      && event.id === "projectile.armed"
      && lateIds.includes(event.entityStableId))).toHaveLength(9);
    expect(easy.events().filter((event) =>
      event.tick120 === 1320
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "pattern_end"
      && lateIds.includes(event.entityStableId))).toHaveLength(9);
    for (let tick120 = 1321; tick120 <= 1782; tick120 += 1) {
      easy.step(safeGapFollowingInput(easy, pattern, tick120));
    }
    expect(easy.events().filter((event) =>
      event.tick120 === 1782
      && event.id === "projectile.residue.remove"
      && lateIds.includes(event.entityStableId))).toHaveLength(9);
  });

  it("samples moving-player contact across the seam and stays trace-identical at 30/60/144 Hz and backlog", {
    timeout: 10000,
  }, () => {
    const contact = new CanonicalCombatKernel({
      ...optionsFor("room.forced.crack_fall_loop"),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
      difficulty: "HARD",
      initialPlayerPosition: {x: 185, y: 70.4},
    });
    for (let tick120 = 1; tick120 <= 90; tick120 += 1) {
      contact.step({
        tick120,
        movement: tick120 === 90 ? {x: -1, y: 0} : {x: 0, y: 0},
        focused: tick120 === 90,
      });
    }
    expect(contact.snapshot()).toMatchObject({
      tick120: 90,
      player: {health: 2},
      lastDamageBatch: {
        tick120: 90,
        committedSourceId: "combat:room.forced.crack_fall_loop/micro/0000:0",
        branch: "non-fatal",
      },
    });
    expect(contact.events().filter((event) => event.id === "projectile.impact.commit"))
      .toHaveLength(1);

    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const baseline = driveCrackFallLoopWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveCrackFallLoopWithDeltas(
        Array.from({length: 210}, () => 1000 / 60),
        targetTick120,
        0,
        "reduced-motion/flash-off/sleet",
      ),
      driveCrackFallLoopWithDeltas(
        Array.from({length: 504}, () => 1000 / 144),
        targetTick120,
        0,
        "full-motion/flash-off/ash",
      ),
      driveCrackFallLoopWithDeltas(
        [durationMs],
        targetTick120,
        0,
        "reduced-motion/default-flash/clear-weather",
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });

  it("feeds ordered pre-mirror segments to active Override and preserves the exact scar coordinate", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.crack_fall_loop"),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
      initialPlayerPosition: {x: 181, y: 200},
      grazeRadiusPx: 1000,
    });
    for (let tick120 = 1; tick120 <= 324; tick120 += 1) {
      const currentY = kernel.snapshot().playerPosition.y;
      const movementY = tick120 >= 91 && tick120 <= 174
        ? Math.max(-1, Math.min(1, (70.4 - currentY) / (PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120)))
        : 0;
      kernel.step({
        tick120,
        movement: {x: 0, y: movementY},
        focused: false,
        ...(tick120 === 174
          ? {overridePressed: true, overrideDirection: {x: 0.9925461516, y: 0.1218693434}}
          : {}),
      });
    }
    const before = kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === "combat:room.forced.crack_fall_loop/micro/0024");
    expect(before).toMatchObject({
      generation: 0,
      state: "flight",
      collisionEnabled: true,
      position: {x: 180, y: 70.4},
      spawnedAtTick: 320,
      armAtTick: 324,
      sourceIndex: 0,
      burstIndex: 2,
    });
    kernel.step({tick120: 325, movement: {x: 0, y: 0}, focused: false});
    const cancelled = kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === "combat:room.forced.crack_fall_loop/micro/0024");
    expect(cancelled).toMatchObject({
      generation: 0,
      state: "residue",
      collisionEnabled: false,
      terminalCause: "cancel",
      position: {x: 181.25829243508707, y: 70.55519775243653},
    });
    expect(kernel.events().filter((event) =>
      event.tick120 === 325
      && event.entityStableId === "combat:room.forced.crack_fall_loop/micro/0024"
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "override_void")).toHaveLength(1);
    expect(kernel.events().some((event) =>
      event.tick120 === 325
      && event.entityStableId === "combat:room.forced.crack_fall_loop/micro/0024"
      && event.id === "projectile.impact.commit")).toBe(false);
    for (let tick120 = 326; tick120 <= 330; tick120 += 1) {
      kernel.step({tick120, movement: {x: 0, y: 0}, focused: false});
    }
    const scar = kernel.events().find((event) =>
      event.tick120 === 330
      && event.id === "cross_run.scar.write.commit"
      && Array.isArray(event.payload.cancellations)
      && event.payload.cancellations.some((entry) =>
        entry.projectileId === "combat:room.forced.crack_fall_loop/micro/0024"));
    expect(scar).toMatchObject({
      payload: {
        x: cancelled?.position.x,
        y: cancelled?.position.y,
        cancellations: [{
          projectileId: "combat:room.forced.crack_fall_loop/micro/0024",
          projectileGeneration: 0,
          x: cancelled?.position.x,
          y: cancelled?.position.y,
        }],
      },
    });
    expect(kernel.events().some((event) => event.id === "player.respawn.place")).toBe(false);
  });

  it("applies the first continuous redirect without canceling the generation", () => {
    const pattern = executablePattern("room.forced.crack_fall_loop");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.crack_fall_loop"),
      seed: CRACK_FALL_LOOP_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 626; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
    }
    const before = kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === "combat:room.forced.crack_fall_loop/micro/0029");
    expect(before).toMatchObject({state: "flight", generation: 0, headingDegrees: 96.84628222552179});
    kernel.step(safeGapFollowingInput(kernel, pattern, 627));
    const redirected = kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === "combat:room.forced.crack_fall_loop/micro/0029");
    const center = safeGapCenter(pattern, 627 * 1000 / 120);
    expect(redirected).toMatchObject({
      state: "flight",
      generation: 0,
      collisionEnabled: true,
      terminalCause: null,
      position: {x: 120.19705963452597, y: 476.5332853908066},
      headingDegrees: 88.84628222552179,
    });
    expect((redirected?.headingDegrees ?? 0) - (before?.headingDegrees ?? 0)).toBe(-8);
    expect(center - (redirected?.position.x ?? 0)).toBe(21);
    expect(kernel.events().filter((event) =>
      event.tick120 === 627
      && event.entityStableId === "combat:room.forced.crack_fall_loop/micro/0029")).toEqual([]);
    expect(kernel.snapshot().adapterGaps.seamTopology).toEqual({
      crossing: "inclusive-arrival-or-departure-first-crossing-per-generation",
      transformSweep: "linear-sweep-then-mirror-discontinuity-sweep",
      corridorEntry: "analytic-relative-sine-extrema-then-bisection",
      redirectedContact: "safe-prefix-then-curvature-bounded-boundary-chord",
      oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees",
    });
    expect(new CanonicalCombatKernel(OPTIONS).snapshot().adapterGaps.seamTopology).toBeUndefined();
    expect(new CanonicalCombatKernel({
      ...OPTIONS,
      patternId: "room.in_between.misregistration_corridor",
      roomId: "IN_BETWEEN",
      projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
    }).snapshot().patternId).toBe("room.in_between.misregistration_corridor");
    expect(new CanonicalCombatKernel({
      ...OPTIONS,
      patternId: "transition.override_void",
    }).snapshot().patternId).toBe("transition.override_void");
  });
});

describe("isolated V4 Override Void pattern", () => {
  const fixture = (): Record<string, unknown> => structuredClone(
    executablePattern("transition.override_void"),
  ) as unknown as Record<string, unknown>;
  const emitter = (pattern: Record<string, unknown>): Record<string, unknown> =>
    (pattern.emitters as unknown[])[0] as Record<string, unknown>;
  const seamParams = (pattern: Record<string, unknown>): Record<string, unknown> =>
    (((emitter(pattern).motionStack as unknown[])[1] as Record<string, unknown>)
      .params as Record<string, unknown>);

  it("pins every immutable field and rejects descriptor or topology drift without reading accessors", () => {
    const source = executablePattern("transition.override_void");
    expect(Object.isFrozen(source)).toBe(true);
    expect(() => validateOverrideVoidPatternContract(source)).not.toThrow();

    const changedHook = fixture();
    changedHook.resolutionHook = "scar_coordinate_seen";
    expect(() => validateOverrideVoidPatternContract(changedHook)).toThrow(/exact contract drifted/);

    const changedVariant = fixture();
    (emitter(changedVariant).geometry as Record<string, unknown>).variant = "generic-ring";
    expect(() => validateOverrideVoidPatternContract(changedVariant)).toThrow(/exact contract drifted/);

    const changedMode = fixture();
    seamParams(changedMode).mode = "mirror";
    expect(() => validateOverrideVoidPatternContract(changedMode)).toThrow(/exact contract drifted/);

    const changedSeed = fixture();
    (changedSeed.seed as Record<string, unknown>).base = 0;
    expect(() => validateOverrideVoidPatternContract(changedSeed)).toThrow(/exact contract drifted/);

    const sparseTimeline = fixture();
    delete (sparseTimeline.timeline as unknown[])[1];
    expect(() => validateOverrideVoidPatternContract(sparseTimeline)).toThrow(/dense/);

    let hookReads = 0;
    const accessorHook = fixture();
    Object.defineProperty(accessorHook, "resolutionHook", {
      get() {
        hookReads += 1;
        return "scar_coordinate_commit";
      },
    });
    expect(() => validateOverrideVoidPatternContract(accessorHook)).toThrow(/own data property/);
    expect(hookReads).toBe(0);

    let offsetReads = 0;
    const accessorOffset = fixture();
    Object.defineProperty(seamParams(accessorOffset), "offsetPx", {
      get() {
        offsetReads += 1;
        return 22;
      },
    });
    expect(() => validateOverrideVoidPatternContract(accessorOffset)).toThrow(/own data property/);
    expect(offsetReads).toBe(0);

    const symbolMetadata = fixture();
    Object.defineProperty(symbolMetadata, Symbol("hidden"), {value: true});
    expect(() => validateOverrideVoidPatternContract(symbolMetadata)).toThrow(/symbol/);

    const geometry = emitter(fixture()).geometry as Readonly<Record<string, unknown>>;
    expect(() => validateRingGeometryContract(geometry)).not.toThrow();
    expect(() => validateRingGeometryContract({...geometry, type: "broken_ring"}))
      .toThrow(/type must be ring/);
    expect(() => validateSeamTransformParameters({seamX: 180, mode: "offset", offsetPx: 22}))
      .not.toThrow();
    expect(() => validateSeamTransformParameters({
      seamX: 180,
      mode: "swap_velocity",
      offsetPx: 22,
    })).toThrow(/admitted mirror or offset topology/);
  });

  it("pins E/N/H cadence, RNG identity, visible rule clips, lifecycle, and trace hashes", {
    timeout: 15000,
  }, () => {
    const pattern = executablePattern("transition.override_void");
    const expected = {
      EASY: {
        count: 12,
        spawnTicks: [84, 320, 557, 794],
        armTicks: [89, 325, 562, 798],
        rng: 48,
        sourceWithdrawn: 2,
        outOfBounds: 31,
        patternEnd: 15,
        residuesAtComplete: 38,
        completeHash: "193dbe2b90324ea80cef276e003262e6f805fd169fb21a0b0a20e717208d769b",
        drainedHash: "f00bd4fedcb6aae210bf6a04a8c19db2179442dbffb59d6671da2323569303f8",
      },
      NORMAL: {
        count: 16,
        spawnTicks: [84, 288, 492, 696],
        armTicks: [89, 293, 497, 701],
        rng: 64,
        sourceWithdrawn: 3,
        outOfBounds: 42,
        patternEnd: 19,
        residuesAtComplete: 41,
        completeHash: "0222f436df16b75e04792e9cf9c5000ab5e31ffe6716a390a33994928ddcce43",
        drainedHash: "5c62bd0bca3d7ce1da8f969de9fe8354c68ae83a0c6754a592cfea74fdb0c251",
      },
      HARD: {
        count: 19,
        spawnTicks: [84, 263, 443, 622],
        armTicks: [89, 268, 448, 627],
        rng: 76,
        sourceWithdrawn: 4,
        outOfBounds: 66,
        patternEnd: 6,
        residuesAtComplete: 44,
        completeHash: "6cbfe5b2fbd821b78ef746b536aab27bddb04852c604519dd7bd0f2c496d7e51",
        drainedHash: "6709ae5aa9dcaa970aef8a25e85c05556a7de05cf6fea6cae5f56c6cdd38057d",
      },
    } as const;

    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      const projection = expected[difficulty];
      expect(roundPatternCount(
        pattern.emitters[0]!.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      )).toBe(projection.count);
      const ringHeadings = geometryCandidates(schedule[0]!.emitter, 0, projection.count)
        .map((candidate) => ((candidate.headingDeg % 360) + 360) % 360)
        .sort((left, right) => left - right);
      const circularHeadingDeltas = ringHeadings.map((heading, index) =>
        ((ringHeadings[(index + 1) % ringHeadings.length]! - heading + 360) % 360));
      expect(ringHeadings).toHaveLength(projection.count);
      expect(circularHeadingDeltas.reduce((total, delta) => total + delta, 0))
        .toBeCloseTo(360, 10);
      for (const delta of circularHeadingDeltas) {
        expect(delta).toBeCloseTo(360 / projection.count, 10);
      }
      expect(schedule.map((entry) => crossedTickCount(entry.atMs))).toEqual(projection.spawnTicks);
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(projection.armTicks);

      const kernel = new CanonicalCombatKernel({
        ...optionsFor("transition.override_void"),
        seed: OVERRIDE_VOID_REPORT_SEED,
        difficulty,
      });
      for (let tick120 = 1; tick120 <= 912; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      const events = kernel.events();
      const count = (id: string, reason?: string): number => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      expect({
        rng: kernel.snapshot().rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        impact: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        residuesAtComplete: kernel.snapshot().projectiles.length,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        rng: projection.rng,
        spawn: projection.rng,
        sourceWithdrawn: projection.sourceWithdrawn,
        outOfBounds: projection.outOfBounds,
        patternEnd: projection.patternEnd,
        impact: 0,
        damage: 0,
        residuesAtComplete: projection.residuesAtComplete,
        hash: projection.completeHash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 912,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        override: {state: "idle", cycle: 0, scarCount: 0},
      });
      expect(kernel.events().some((event) =>
        event.id.startsWith("player.override.") || event.id === "cross_run.scar.write.commit"))
        .toBe(false);
      const firstClip = events.find((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === "source_withdrawn");
      expect(firstClip).toBeDefined();
      expect(events.filter((event) =>
        event.tick120 === firstClip?.tick120 && event.entityStableId === firstClip?.entityStableId)
        .map((event) => event.id)).toEqual([
        "projectile.collision.off",
        "projectile.cancel.commit",
        "projectile.residue.begin",
      ]);

      for (let tick120 = 913; tick120 <= 1257; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      expect(kernel.snapshot().projectileLifecycleDrained).toBe(false);
      kernel.step(safeGapFollowingInput(kernel, pattern, 1258));
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1258,
        projectiles: [],
        projectileLifecycleDrained: true,
        handoffReady: true,
      });
      expect(kernel.events().filter((event) =>
        event.tick120 === 1258 && event.id === "projectile.residue.remove"))
        .toHaveLength(projection.patternEnd);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(projection.drainedHash);
      expect(kernel.projectilePoolAudit()).toEqual([]);
    }
  });

  it("applies one heading-preserving offset and sweeps the discontinuity for contact", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("transition.override_void"),
      seed: OVERRIDE_VOID_REPORT_SEED,
      initialPlayerPosition: {x: 20, y: 20},
    });
    for (let tick120 = 1; tick120 <= 89; tick120 += 1) kernel.step(inputAt(tick120));
    const armed = kernel.snapshot().projectiles.find((projectile) => projectile.sourceIndex === 0);
    const negativeArmed = kernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceIndex === 1);
    expect(armed).toMatchObject({state: "flight", position: {x: 180, y: 128}});
    expect(negativeArmed).toMatchObject({state: "flight", position: {x: 180, y: 128}});
    expect(Math.cos((negativeArmed?.headingDegrees ?? 0) * Math.PI / 180)).toBeLessThan(0);
    kernel.step(inputAt(90));
    const transformed = kernel.snapshot().projectiles.find((projectile) => projectile.sourceIndex === 0);
    const negativeTransformed = kernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceIndex === 1);
    expect(transformed?.headingDegrees).toBe(armed?.headingDegrees);
    expect((transformed?.position.x ?? 0) - (armed?.position.x ?? 0)).toBeCloseTo(
      22.00144305845856,
      12,
    );
    expect(negativeTransformed?.headingDegrees).toBe(negativeArmed?.headingDegrees);
    expect((negativeTransformed?.position.x ?? 0) - (negativeArmed?.position.x ?? 0)).toBeCloseTo(
      -22.39877026911324,
      12,
    );
    kernel.step(inputAt(91));
    const next = kernel.snapshot().projectiles.find((projectile) => projectile.sourceIndex === 0);
    const negativeNext = kernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceIndex === 1);
    expect(next?.headingDegrees).toBe(transformed?.headingDegrees);
    expect((next?.position.x ?? 0) - (transformed?.position.x ?? 0)).toBeCloseTo(
      0.00144305845857,
      12,
    );
    expect(negativeNext?.headingDegrees).toBe(negativeTransformed?.headingDegrees);
    expect((negativeNext?.position.x ?? 0) - (negativeTransformed?.position.x ?? 0)).toBeCloseTo(
      -0.39877026911325,
      12,
    );
    expect(kernel.snapshot().adapterGaps.offsetSeamTopology).toEqual({
      crossing: "inclusive-arrival-or-departure-first-crossing-per-generation",
      transformSweep: "linear-sweep-then-signed-offset-discontinuity-sweep",
      headingPolicy: "preserved-across-offset",
      contactAndOverridePaths: "both-linear-and-discontinuity-segments",
      resolutionHook: "validated-inert-no-automatic-completion",
      realScarEvidence: "separate-directional-override-authority",
      sameTickTerminalPriority: "rule-clip-before-override-no-double-terminal-no-linked-scar",
    });

    const contact = new CanonicalCombatKernel({
      ...optionsFor("transition.override_void"),
      seed: OVERRIDE_VOID_REPORT_SEED,
      initialPlayerPosition: {x: 191, y: 128},
    });
    for (let tick120 = 1; tick120 <= 90; tick120 += 1) contact.step(inputAt(tick120));
    expect(contact.snapshot()).toMatchObject({
      player: {health: 2},
      lastDamageBatch: {
        tick120: 90,
        committedSourceId: "combat:transition.override_void/micro/0000:0",
      },
    });
    expect(contact.events().filter((event) =>
      event.tick120 === 90
      && event.entityStableId === "combat:transition.override_void/micro/0000"
      && event.id === "projectile.impact.commit")).toHaveLength(1);
  });

  it("feeds both offset sides to active Override and writes only the exact real terminal scar", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("transition.override_void"),
      seed: OVERRIDE_VOID_REPORT_SEED,
      initialPlayerPosition: {x: 191, y: 128},
      grazeRadiusPx: 1000,
    });
    for (let tick120 = 1; tick120 <= 293; tick120 += 1) {
      kernel.step({
        tick120,
        movement: {x: 0, y: 0},
        focused: false,
        ...(tick120 === 214
          ? {overridePressed: true, overrideDirection: {x: 1, y: 0}}
          : {}),
      });
    }
    expect(kernel.snapshot()).toMatchObject({
      evidence: {amount: 7, consumedPurposeCount: 1},
      override: {
        state: "active",
        cycle: 1,
        deadlineTick120: 370,
        globalInvulnerability: false,
      },
    });
    const before = kernel.snapshot().projectiles.find((projectile) =>
      projectile.burstIndex === 1 && projectile.sourceIndex === 12);
    expect(before).toMatchObject({state: "flight", position: {x: 180, y: 128}});
    const linearEndX = (before?.position.x ?? 0)
      + Math.cos((before?.headingDegrees ?? 0) * Math.PI / 180)
        * (before?.speedPxPerSecond ?? 0) / 120;
    expect(linearEndX).toBeLessThan(182);

    kernel.step({tick120: 294, movement: {x: 0, y: 0}, focused: false});
    const cancelled = kernel.snapshot().projectiles.find((projectile) =>
      projectile.burstIndex === 1 && projectile.sourceIndex === 12);
    expect(cancelled).toMatchObject({
      state: "residue",
      terminalCause: "cancel",
      collisionEnabled: false,
      position: {x: 191.06282286584272, y: 127.97202945803353},
    });
    expect((cancelled?.position.x ?? 0) - linearEndX).toBeGreaterThan(9);
    expect(kernel.events().filter((event) =>
      event.tick120 === 294
      && event.entityStableId === cancelled?.instanceId
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "override_void")).toHaveLength(1);

    for (let tick120 = 295; tick120 <= 370; tick120 += 1) {
      kernel.step({tick120, movement: {x: 0, y: 0}, focused: false});
    }
    const scar = kernel.events().find((event) =>
      event.tick120 === 370
      && event.id === "cross_run.scar.write.commit"
      && Array.isArray(event.payload.cancellations)
      && event.payload.cancellations.some((entry) =>
        entry.projectileId === cancelled?.instanceId));
    expect(scar).toMatchObject({
      payload: {
        x: cancelled?.position.x,
        y: cancelled?.position.y,
        cancellations: [{
          projectileId: cancelled?.instanceId,
          projectileGeneration: 0,
          x: cancelled?.position.x,
          y: cancelled?.position.y,
        }],
      },
    });
  });

  it("gives a simultaneous corridor clip priority without a second terminal or linked scar", () => {
    const originX = 202.45600647290576;
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("transition.override_void"),
      seed: OVERRIDE_VOID_REPORT_SEED,
      initialPlayerPosition: {x: originX, y: 476},
      grazeRadiusPx: 1000,
    });
    for (let tick120 = 1; tick120 <= 405; tick120 += 1) {
      kernel.step({
        tick120,
        movement: {x: tick120 >= 321 && tick120 <= 421 ? 1 : 0, y: 0},
        focused: false,
        ...(tick120 === 320
          ? {overridePressed: true, overrideDirection: {x: 0, y: 1}}
          : {}),
      });
    }
    const before = kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === "combat:transition.override_void/micro/0000");
    const localVoid = kernel.snapshot().override.localVoid;
    expect(before).toMatchObject({state: "flight", position: {y: 475.5997008889624}});
    expect(localVoid).not.toBeNull();
    kernel.step({tick120: 406, movement: {x: 1, y: 0}, focused: false});
    const clipped = kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === before?.instanceId);
    expect(clipped).toMatchObject({
      state: "residue",
      terminalCause: "cancel",
      position: {y: 476.6996999424085},
    });
    expect(localVoid === null || before === undefined || clipped === undefined
      ? null
      : sweepSegmentIntoSector(before.position, clipped.position, localVoid)).not.toBeNull();
    expect(kernel.events().filter((event) =>
      event.tick120 === 406 && event.entityStableId === before?.instanceId)
      .map((event) => [event.id, event.payload.reason ?? null])).toEqual([
      ["projectile.collision.off", "source_withdrawn"],
      ["projectile.cancel.commit", "source_withdrawn"],
      ["projectile.residue.begin", null],
    ]);

    for (let tick120 = 407; tick120 <= 476; tick120 += 1) {
      kernel.step({
        tick120,
        movement: {x: tick120 <= 421 ? 1 : 0, y: 0},
        focused: false,
      });
    }
    expect(kernel.events().filter((event) =>
      event.entityStableId === before?.instanceId
      && event.id === "projectile.cancel.commit")).toHaveLength(1);
    const closeScars = kernel.events().filter((event) =>
      event.tick120 === 476 && event.id === "cross_run.scar.write.commit");
    expect(closeScars).toHaveLength(1);
    expect(closeScars[0]?.payload).toMatchObject({x: originX, y: 476, cancellations: []});
    expect(closeScars.some((event) =>
      Array.isArray(event.payload.cancellations)
      && event.payload.cancellations.some((entry) => entry.projectileId === before?.instanceId)))
      .toBe(false);
  });

  it("stays cadence/projection-identical and relative to a nonzero isolated start", {
    timeout: 15000,
  }, () => {
    const targetTick120 = 420;
    const baseline = driveOverrideVoidWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveOverrideVoidWithDeltas(
        Array.from({length: 210}, () => 1000 / 60),
        targetTick120,
        {weatherEvent: "rain", reducedMotion: true, flashOff: false},
      ),
      driveOverrideVoidWithDeltas(
        Array.from({length: 504}, () => 1000 / 144),
        targetTick120,
        {weatherEvent: "ash", reducedMotion: false, flashOff: true},
      ),
      driveOverrideVoidWithDeltas(
        [targetTick120 * 1000 / 120],
        targetTick120,
        {weatherEvent: "sleet", reducedMotion: true, flashOff: true},
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }

    const pattern = executablePattern("transition.override_void");
    const startTick120 = 401;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("transition.override_void"),
      seed: OVERRIDE_VOID_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("transition.override_void"),
      seed: OVERRIDE_VOID_REPORT_SEED,
      startTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number): void => {
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120: kernel.snapshot().startTick120 + relativeTick120,
        movement: {x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)), y: 0},
        focused: false,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 1258; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalize = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const relativeMilliseconds = (value: number): number =>
        Math.round((value - start * 1000 / 120) * 1_000_000_000) / 1_000_000_000;
      const payload = (value: Readonly<Record<string, unknown>>) => {
        const copy = {...value};
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof copy[key] === "number") copy[key] = relativeMilliseconds(copy[key]);
        }
        return copy;
      };
      return {
        snapshot: {
          ...kernel.snapshot(),
          startTick120: 0,
          tick120: kernel.snapshot().relativeTick120,
          player: {
            ...kernel.snapshot().player,
            tick120: kernel.snapshot().player.tick120 - start,
          },
          override: {
            ...kernel.snapshot().override,
            tick120: kernel.snapshot().override.tick120 - start,
          },
        },
        events: kernel.events().map((event) => ({
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMilliseconds(event.simulationTimeMs),
          payload: payload(event.payload),
        })),
      };
    };
    expect(normalize(offset)).toEqual(normalize(zero));
    expect(offset.snapshot()).toMatchObject({
      startTick120,
      tick120: startTick120 + 1258,
      relativeTick120: 1258,
      projectiles: [],
      handoffReady: true,
    });
  });
});

describe("bounded Misreader enforce-entry laser fragment", () => {
  const ENTRY_TICK = 2;

  function fixture(
    occurrenceId = "misreader:enforce-entry:0",
    initialPlayerPosition = {x: 350, y: 600},
  ) {
    const bus = new CanonicalEventBus();
    const boss = new BossPhaseAuthority("boss.misreader", 1, bus);
    boss.begin(0);
    bus.flush();
    const fragment = new CanonicalMisreaderEnforceEntryFragment(bus, boss, {
      occurrenceId,
      phaseEntryTick120: ENTRY_TICK,
      phaseExitAuthorization: "caller-validated:misreader.evidence>=1",
      initialPlayerPosition,
      projectileDamage: OPTIONS.projectileDamage,
    });
    return {bus, boss, fragment};
  }

  function stationaryInput(tick120: number): CanonicalCombatStepInput {
    return {tick120, movement: {x: 0, y: 0}, focused: false};
  }

  it("commits one manifest-bound entry shot and drains it at exact natural boundaries", () => {
    const {boss, fragment} = fixture();
    expect(fragment.snapshot()).toMatchObject({
      authority: "misreader-enforce-entry-laser-v4-adapter",
      tick120: ENTRY_TICK - 1,
      boss: {phaseId: "observe"},
      laser: {state: "idle"},
      fullAttackPlanExecuted: false,
      adapterPolicy: {
        laserStartsPerEntry: 1,
        repeatCadence: null,
        capsuleCount: 16,
        phaseEvidenceEvaluator: null,
        phaseExitAuthorization: "caller-validated:misreader.evidence>=1",
      },
    });

    fragment.step(stationaryInput(ENTRY_TICK));
    expect(fragment.snapshot()).toMatchObject({
      boss: {phaseId: "enforce", state: "active"},
      laser: {state: "warning", collisionEnabled: false},
      firstContactEligibleTick120: ENTRY_TICK + 152,
      fullAttackPlanExecuted: false,
    });
    expect(fragment.snapshot().geometry?.capsules).toHaveLength(16);
    const entryEvents = fragment.events().filter((event) => event.tick120 === ENTRY_TICK);
    expect(entryEvents.map((event) => event.id)).toEqual([
      "boss.phase.exit",
      "boss.phase.swap",
      "boss.phase.enter",
      "boss.phase.attack_plan.commit",
      "projectile.spawn.commit",
    ]);
    expect(entryEvents.at(-1)?.payload.archetypeId).toBe("laser.misread_bezier");

    for (let tick120 = ENTRY_TICK + 1; tick120 <= ENTRY_TICK + 150; tick120 += 1) {
      fragment.step(stationaryInput(tick120));
    }
    expect(fragment.snapshot().laser).toMatchObject({
      state: "arming",
      collisionEnabled: false,
    });
    fragment.step(stationaryInput(ENTRY_TICK + 151));
    expect(fragment.snapshot().laser).toMatchObject({state: "active", collisionEnabled: true});
    expect(fragment.snapshot().contactAttemptTick120).toBeNull();
    expect(fragment.events().filter((event) =>
      event.tick120 === ENTRY_TICK + 151).map((event) => event.id)).toEqual([
      "projectile.armed",
      "projectile.flight.begin",
      "projectile.collision.on",
    ]);

    for (let tick120 = ENTRY_TICK + 152; tick120 <= ENTRY_TICK + 263; tick120 += 1) {
      fragment.step(stationaryInput(tick120));
    }
    expect(fragment.snapshot().laser).toMatchObject({state: "active", collisionEnabled: true});
    fragment.step(stationaryInput(ENTRY_TICK + 264));
    expect(fragment.snapshot()).toMatchObject({
      collisionBodyDrained: true,
      materialResidueDraining: false,
      laser: {state: "shutdown", collisionEnabled: false},
    });
    for (let tick120 = ENTRY_TICK + 265; tick120 <= ENTRY_TICK + 285; tick120 += 1) {
      fragment.step(stationaryInput(tick120));
    }
    fragment.step(stationaryInput(ENTRY_TICK + 286));
    expect(fragment.snapshot()).toMatchObject({
      materialResidueDraining: true,
      laserLifecycleDrained: false,
      laser: {state: "residue"},
    });
    for (let tick120 = ENTRY_TICK + 287; tick120 <= ENTRY_TICK + 365; tick120 += 1) {
      fragment.step(stationaryInput(tick120));
    }
    const beforeClose = fragment.events().length;
    const prepared = fragment.advanceTick(stationaryInput(ENTRY_TICK + 366));
    expect(prepared).toMatchObject({laserLifecycleDrained: true, laser: {state: "cleanup"}});
    expect(fragment.events()).toHaveLength(beforeClose);
    expect(fragment.flushTick(ENTRY_TICK + 366).map((event) => event.id)).toEqual([
      "projectile.residue.remove",
      "projectile.lifecycle.complete",
    ]);
    expect(boss.snapshot()).toMatchObject({state: "active", phaseId: "enforce"});
    expect(fragment.events().filter((event) =>
      event.id === "projectile.spawn.commit"
      && event.payload.archetypeId === "laser.misread_bezier")).toHaveLength(1);
    expect(fragment.events().filter((event) =>
      event.id === "boss.phase.exit"
      && event.tick120 > ENTRY_TICK)).toEqual([]);
  });

  it("allows first contact only at +152 and keeps the persistent beam on its natural lifecycle", () => {
    const geometry = compileLaserGeometry("laser.misread_bezier", {tick120: 0});
    const capsule = geometry.capsules[0];
    expect(capsule).toBeDefined();
    if (capsule === undefined) return;
    const onBeam = {
      x: (capsule.from.x + capsule.to.x) / 2,
      y: (capsule.from.y + capsule.to.y) / 2,
    };
    const {fragment} = fixture("misreader:contact:0", onBeam);
    for (let tick120 = ENTRY_TICK; tick120 <= ENTRY_TICK + 151; tick120 += 1) {
      fragment.step(stationaryInput(tick120));
    }
    expect(fragment.snapshot()).toMatchObject({
      contactAttemptTick120: null,
      player: {health: 3},
      laser: {state: "active", collisionEnabled: true},
    });
    fragment.step(stationaryInput(ENTRY_TICK + 152));
    expect(fragment.snapshot()).toMatchObject({
      contactAttemptTick120: ENTRY_TICK + 152,
      player: {health: 2},
      lastDamageBatch: {branch: "non-fatal"},
      laser: {state: "active", collisionEnabled: true, terminalCause: null},
    });
    expect(fragment.events().filter((event) => event.id === "player.damage.commit")).toHaveLength(1);
    expect(fragment.events().filter((event) => event.id === "projectile.impact.commit")).toEqual([]);
    for (let tick120 = ENTRY_TICK + 153; tick120 <= ENTRY_TICK + 264; tick120 += 1) {
      fragment.step(stationaryInput(tick120));
    }
    expect(fragment.snapshot()).toMatchObject({
      contactAttemptTick120: ENTRY_TICK + 152,
      player: {health: 2},
      laser: {state: "shutdown", terminalTick120: ENTRY_TICK + 264, terminalCause: "cancel"},
    });
    expect(fragment.events().filter((event) => event.id === "player.damage.commit")).toHaveLength(1);
  });

  it("rejects an injected laser-spawn conflict without advancing shared, Boss, or laser state", () => {
    const initialPlayerPosition = {x: 100, y: 600};
    const {bus, boss, fragment} = fixture(
      "misreader:conflict:0",
      initialPlayerPosition,
    );
    const before = fragment.snapshot();
    const instanceId = before.laser.instanceId;
    bus.enqueue({
      id: "projectile.spawn.commit",
      tick120: ENTRY_TICK,
      entityStableId: "fixture:conflict",
      localSequence: 0,
      occurrenceKey: `${instanceId}:0:spawn`,
      payload: {
        instanceId: "fixture:conflict",
        generation: 0,
        archetypeId: "fixture.conflict",
      },
    });
    expect(() => fragment.advanceTick({
      tick120: ENTRY_TICK,
      movement: {x: 1, y: 0},
      focused: true,
    })).toThrow(
      /duplicate authoritative occurrence key/,
    );
    expect(boss.snapshot()).toMatchObject({state: "active", phaseId: "observe"});
    expect(fragment.snapshot().laser).toEqual(before.laser);
    expect(fragment.snapshot()).toMatchObject({
      tick120: ENTRY_TICK - 1,
      playerPosition: initialPlayerPosition,
      focused: false,
      player: {tick120: ENTRY_TICK - 1},
      override: {tick120: ENTRY_TICK - 1},
    });
    expect(() => fragment.advanceTick(stationaryInput(ENTRY_TICK)))
      .toThrow(/Misreader laser fragment is faulted/);
  });

  it("rejects validated catalog drift instead of reporting canonical V4 authority", () => {
    const source = structuredClone(defaultEncounterManifestSource()) as EncounterManifestSource & {
      bosses: {rigs: Array<{
        id: string;
        phases: Array<{exitCondition: string; spatialLaw: string}>;
      }>};
    };
    const rig = source.bosses.rigs.find((entry) => entry.id === "boss.misreader");
    expect(rig).toBeDefined();
    if (rig === undefined) return;
    const observe = rig.phases[0];
    const enforce = rig.phases[1];
    expect(observe).toBeDefined();
    expect(enforce).toBeDefined();
    if (observe === undefined || enforce === undefined) return;
    observe.exitCondition = "silently-drifted-exit";
    enforce.spatialLaw = "silently-drifted-law";
    const catalog = validateEncounterAuthorityManifests(source);
    const bus = new CanonicalEventBus();
    const boss = new BossPhaseAuthority("boss.misreader", 1, bus, catalog);
    boss.begin(0);
    bus.flush();
    expect(() => new CanonicalMisreaderEnforceEntryFragment(bus, boss, {
      occurrenceId: "misreader:drift:0",
      phaseEntryTick120: ENTRY_TICK,
      phaseExitAuthorization: "caller-validated:misreader.evidence>=1",
      initialPlayerPosition: {x: 180, y: 600},
      projectileDamage: OPTIONS.projectileDamage,
    })).toThrow(/manifest-derived active observe -> enforce binding/);
    expect(boss.snapshot().phaseId).toBe("observe");
  });

  it("rejects own-method shadows before a Boss/laser entry batch can append", () => {
    const bus = new CanonicalEventBus();
    const boss = new BossPhaseAuthority("boss.misreader", 1, bus);
    boss.begin(0);
    bus.flush();
    const laser = new LaserAuthority(
      bus,
      "laser.misread_bezier",
      "misreader:shadowed-laser",
    );
    Object.defineProperty(laser, "applyPreparedMutationAfterAppend", {
      configurable: true,
      value: () => {
        throw new Error("shadowed apply must never run");
      },
    });
    expect(() => commitBossPhaseExitWithLaserStart(
      bus,
      boss,
      laser,
      "observe",
      ENTRY_TICK,
      "misreader.evidence>=1",
    )).toThrow(/exact LaserAuthority/);
    expect(boss.snapshot().phaseId).toBe("observe");
    expect(laser.snapshot().state).toBe("idle");
    expect(bus.flush()).toEqual([]);
  });

  it("stages contact damage so an occurrence conflict cannot consume health or add a lease", () => {
    const geometry = compileLaserGeometry("laser.misread_bezier", {tick120: 0});
    const capsule = geometry.capsules[0];
    expect(capsule).toBeDefined();
    if (capsule === undefined) return;
    const onBeam = {
      x: (capsule.from.x + capsule.to.x) / 2,
      y: (capsule.from.y + capsule.to.y) / 2,
    };
    const {bus, fragment} = fixture("misreader:damage-conflict:0", onBeam);
    for (let tick120 = ENTRY_TICK; tick120 <= ENTRY_TICK + 151; tick120 += 1) {
      fragment.step(stationaryInput(tick120));
    }
    const laser = fragment.snapshot().laser;
    const contactTick = ENTRY_TICK + 152;
    const sourceId = `${laser.instanceId}:${laser.generation}`;
    bus.enqueue({
      id: "boss.encounter.resolve",
      tick120: contactTick,
      entityStableId: "fixture:damage-conflict",
      localSequence: 0,
      occurrenceKey: `player:damage:contact:${sourceId}:tick:${contactTick}`,
      payload: {
        bossId: "fixture.damage-conflict",
        generation: 1,
        outcome: "occupied",
        finalPhaseId: "fixture",
      },
    });
    expect(() => fragment.advanceTick(stationaryInput(contactTick))).toThrow(
      /duplicate authoritative occurrence key/,
    );
    expect(fragment.snapshot()).toMatchObject({
      contactAttemptTick120: null,
      lastDamageBatch: null,
      player: {health: 3, activeLeases: []},
      laser: {state: "active", collisionEnabled: true, terminalCause: null},
    });
    expect(() => fragment.advanceTick(stationaryInput(contactTick + 1)))
      .toThrow(/Misreader laser fragment is faulted/);
  });

  it("keeps one authority trace across render cadences and presentation-only accessibility profiles", () => {
    const targetTick120 = ENTRY_TICK + 366;
    const drive = (deltas: readonly number[], presentationProfile: string) => {
      const {fragment} = fixture("misreader:cadence:0");
      // The label is deliberately observed only by the test harness; no
      // weather/accessibility/presentation field enters authority input.
      expect(presentationProfile.length).toBeGreaterThan(0);
      const clock = new AuthorityClock({
        onTick120: ({tick120}) => {
          if (tick120 >= ENTRY_TICK && tick120 <= targetTick120) {
            fragment.step(stationaryInput(tick120));
          }
        },
      });
      for (const delta of deltas) clock.advance(delta);
      while (clock.snapshot().backlogTicks > 0) clock.advance(0);
      expect(clock.snapshot().tick120).toBeGreaterThanOrEqual(targetTick120);
      expect(fragment.snapshot().tick120).toBe(targetTick120);
      return fragment;
    };
    const at30Hz = drive(
      Array.from({length: 92}, () => 1000 / 30),
      "full-motion/default-flash/clear-weather",
    );
    const at144Hz = drive(
      Array.from({length: 442}, () => 1000 / 144),
      "reduced-motion/flash-off/sleet",
    );
    const oneLargeDelta = drive(
      [targetTick120 * 1000 / 120],
      "full-motion/flash-off/ash",
    );
    expect(at144Hz.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(oneLargeDelta.canonicalEventSerialization()).toBe(at30Hz.canonicalEventSerialization());
    expect(at144Hz.snapshot()).toEqual(at30Hz.snapshot());
    expect(oneLargeDelta.snapshot()).toEqual(at30Hz.snapshot());
  });
});

describe("isolated Context Switch combat capability", () => {
  it("pins the exact V4 contract, adapter provenance, and separate 30Hz oracle evidence", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.context_switch"),
      seed: CONTEXT_SWITCH_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateContextSwitchPatternContract(contract)).not.toThrow();
    expect(contract).toMatchObject({
      id: "room.in_between.context_switch",
      category: "ROOM",
      room: "IN_BETWEEN",
      durationMs: 11400,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 726, event: "collision.arm"},
        {atMs: 726, event: "emit.begin"},
        {atMs: 5700, event: "pattern.midpoint"},
        {atMs: 10700, event: "emit.end"},
        {atMs: 10980, event: "residue.commit"},
        {atMs: 11400, event: "pattern.complete"},
      ],
      safeGap: {
        type: "intersection_track",
        minimumWidthPx: 32,
        focusMinimumWidthPx: 24,
        enforcement: "operator_constraint",
        path: {centerX: 180, amplitudePx: 34, periodMs: 6400, phase: 0, laneX: []},
      },
      warning: {durationMs: 726, shape: "incompatible_turn_fields"},
      residue: {type: "misregistration_flake", lifetimeMs: 3150, density: 0.24},
      seed: {base: 2740017633},
      emitters: [
        expect.objectContaining({
          id: "system-a",
          anchor: {space: "viewport-normalized", x: 0.3, y: 0.12},
          geometry: expect.objectContaining({
            type: "fan", variant: "rectilinear-a", count: 8,
            baseAngleDeg: 78, spreadDeg: 76,
          }),
          cadence: {startMs: 726, intervalMs: 920, bursts: 11, intraBurstMs: 0},
          motionStack: [
            {operator: "op.linear", params: {}},
            {operator: "op.turn_once", params: {atMs: 740, deltaDeg: 22}},
          ],
        }),
        expect.objectContaining({
          id: "system-b",
          anchor: {space: "viewport-normalized", x: 0.7, y: 0.16},
          geometry: expect.objectContaining({
            type: "fan", variant: "broken-b", count: 9,
            baseAngleDeg: 102, spreadDeg: 96,
          }),
          cadence: {startMs: 956, intervalMs: 1160, bursts: 9, intraBurstMs: 0},
          motionStack: [
            {
              operator: "op.speed_envelope",
              params: {
                keys: [{atMs: 0, multiplier: 0.72}, {atMs: 520, multiplier: 1.28}],
                interpolation: "linear",
              },
            },
            {operator: "op.turn_once", params: {atMs: 980, deltaDeg: -28}},
            {operator: "op.linear", params: {}},
          ],
        }),
      ],
    });
    expect(kernel.snapshot().adapterGaps.contextConstraint).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      declarationOrder: "motion-stack-literal-before-operator-constraint",
      corridorEntry: "analytic-relative-sine-extrema-then-bisection",
      redirectedContact: "safe-prefix-then-curvature-bounded-boundary-chord",
      oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees",
      completeTickTie: "spawn-then-pattern-end-residue-under-canonical-phase-order",
    });

    const expected = {
      EASY: [19, 122, 104, "43c0ccdeed148b1608137f2db353d90fb89a53361a86a0bc4f263007eadcc30d"],
      NORMAL: [20, 169, 154, "eaee02492d1be50f8df214f226ffe8be568b89b35085e25e3a9fa4ec5657846c"],
      HARD: [20, 198, 273, "4cc95eb7f32cce086ddf5ff8cee009f4602664dfdb346a09a32f81c534578577"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: CONTEXT_SWITCH_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: CONTEXT_SWITCH_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expected[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("fails closed on hostile Context source shape without invoking accessors", () => {
    const source = structuredClone(executablePattern("room.in_between.context_switch")) as unknown as {
      safeGap: {enforcement: string};
      emitters: Array<{motionStack: Array<{operator: string; params: Record<string, unknown>}>}>;
      metadata?: string;
    };
    expect(() => validateContextSwitchPatternContract(source)).not.toThrow();
    expect(() => validateContextSwitchPatternContract({...source, metadata: "write-back"}))
      .toThrow(/keys|contract/);
    const gapDrift = structuredClone(source);
    gapDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateContextSwitchPatternContract(gapDrift)).toThrow(/authored contract/);
    const emitterOrder = structuredClone(source);
    emitterOrder.emitters.reverse();
    expect(() => validateContextSwitchPatternContract(emitterOrder)).toThrow(/system-a|emitter/);
    const motionOrder = structuredClone(source);
    motionOrder.emitters[0]!.motionStack.reverse();
    expect(() => validateContextSwitchPatternContract(motionOrder)).toThrow(/declaration order/);
    const envelopeDrift = structuredClone(source);
    envelopeDrift.emitters[1]!.motionStack[0]!.params.interpolation = "step";
    expect(() => validateContextSwitchPatternContract(envelopeDrift)).toThrow(/envelope or turn/);
    const extraParameter = structuredClone(source);
    extraParameter.emitters[1]!.motionStack[1]!.params.presentationSeed = 7;
    expect(() => validateContextSwitchPatternContract(extraParameter)).toThrow(/keys|contract/);

    let reads = 0;
    const accessor = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        reads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateContextSwitchPatternContract(accessor)).toThrow(/own data property/);
    expect(reads).toBe(0);
  });

  it("keeps authored cadence order and the complete-tick late identity", () => {
    const pattern = executablePattern("room.in_between.context_switch");
    const easy = createPatternSchedule(pattern, "EASY");
    expect(easy).toHaveLength(19);
    expect(easy.reduce((total, entry) => total + roundPatternCount(
      entry.emitter.geometry.count * pattern.difficulty.EASY.countMultiplier,
    ), 0)).toBe(122);
    expect(easy.filter((entry) => crossedTickCount(entry.atMs) === 600)
      .map((entry) => [entry.emitter.id, entry.burstIndex, Number(entry.atMs.toFixed(3))]))
      .toEqual([
        ["system-b", 3, 4992.8],
        ["system-a", 4, 4994.8],
      ]);
    const final = easy[easy.length - 1];
    expect(final?.emitter.id).toBe("system-a");
    expect(final?.burstIndex).toBe(10);
    expect(final?.atMs).toBeCloseTo(11398, 9);
    expect(final?.atMs).toBeGreaterThan(10980);
    expect(final?.atMs).toBeLessThan(pattern.durationMs);
    expect(crossedTickCount(final?.atMs ?? Number.NaN)).toBe(1368);
    expect(crossedTickCount(pattern.durationMs)).toBe(1368);
    expect(crossedTickCount((final?.atMs ?? 0) + 40)).toBe(1373);
  });

  it("executes the two declaration orders and the linear envelope key exactly", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.context_switch"),
      seed: CONTEXT_SWITCH_REPORT_SEED,
      difficulty: "EASY",
    });
    const stepTo = (targetTick120: number) => {
      for (let tick120 = kernel.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
        kernel.step({...inputAt(tick120), focused: false});
      }
    };
    const find = (sourceId: string) => kernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceId === sourceId
      && projectile.burstIndex === 0
      && projectile.sourceIndex === 0);

    stepTo(175);
    const systemAAt175 = find("system-a");
    stepTo(176);
    const systemAAt176 = find("system-a");
    expect(systemAAt175).toBeDefined();
    expect(systemAAt176).toBeDefined();
    if (systemAAt175 !== undefined && systemAAt176 !== undefined) {
      const radians = systemAAt175.headingDegrees * Math.PI / 180;
      expect(systemAAt176.position.x - systemAAt175.position.x)
        .toBeCloseTo(Math.cos(radians) * 128.48 / 120, 11);
      expect(systemAAt176.position.y - systemAAt175.position.y)
        .toBeCloseTo(Math.sin(radians) * 128.48 / 120, 11);
      expect(systemAAt176.headingDegrees - systemAAt175.headingDegrees).toBeCloseTo(22, 12);
    }

    stepTo(177);
    const systemBAt177 = find("system-b");
    stepTo(178);
    const systemBAt178 = find("system-b");
    expect(systemBAt177).toBeDefined();
    expect(systemBAt178).toBeDefined();
    if (systemBAt177 !== undefined && systemBAt178 !== undefined) {
      const multiplierAt519 = 0.72 + (1.28 - 0.72) * 519 / 520;
      const expectedDistance = 154 * 0.88 * (
        (multiplierAt519 + 1.28) / 2 / 1000
        + 1.28 * (1000 / 120 - 1) / 1000
      );
      expect(Math.hypot(
        systemBAt178.position.x - systemBAt177.position.x,
        systemBAt178.position.y - systemBAt177.position.y,
      )).toBeCloseTo(expectedDistance, 11);
      expect(systemBAt178.speedPxPerSecond).toBeCloseTo(154 * 0.88 * 1.28, 12);
    }

    stepTo(232);
    const systemBAt232 = find("system-b");
    stepTo(233);
    const systemBAt233 = find("system-b");
    expect(systemBAt232).toBeDefined();
    expect(systemBAt233).toBeDefined();
    if (systemBAt232 !== undefined && systemBAt233 !== undefined) {
      expect(systemBAt233.headingDegrees - systemBAt232.headingDegrees).toBeCloseTo(-28, 12);
      const radians = systemBAt233.headingDegrees * Math.PI / 180;
      expect(systemBAt233.position.x - systemBAt232.position.x)
        .toBeCloseTo(Math.cos(radians) * systemBAt233.speedPxPerSecond / 120, 11);
      expect(systemBAt233.position.y - systemBAt232.position.y)
        .toBeCloseTo(Math.sin(radians) * systemBAt233.speedPxPerSecond / 120, 11);
    }

    stepTo(600);
    expect(kernel.snapshot().projectiles.filter((projectile) => projectile.spawnedAtTick === 600)
      .map((projectile) => projectile.sourceId)).toEqual([
        "system-b", "system-b", "system-b", "system-b", "system-b", "system-b", "system-b",
        "system-a", "system-a", "system-a", "system-a", "system-a", "system-a",
      ]);
  });

  it("retains every identity, redirects without withdrawal, and pins E/N/H production traces", {
    timeout: 20000,
  }, () => {
    const pattern = executablePattern("room.in_between.context_switch");
    const expected = {
      EASY: {
        candidates: 122, outOfBounds: 75, patternEnd: 47, residues: 82,
        redirects: {left: 93, right: 49},
        hash: "7cb60b23323a16da617297daec9b3ce437cc1246e56b28f629b3288eff163bb0",
      },
      NORMAL: {
        candidates: 169, outOfBounds: 120, patternEnd: 49, residues: 99,
        redirects: {left: 110, right: 50},
        hash: "99a2e087c38cbdd977766c3c3133d3ae8f3c6682ab7ce61f92fce524c0a9a1fb",
      },
      HARD: {
        candidates: 198, outOfBounds: 166, patternEnd: 32, residues: 103,
        redirects: {left: 215, right: 121},
        hash: "b5a55f8da9c3a317289c8d871a1ad31c2a91973e5f8f923f3350496c37cb2855",
      },
    } as const;
    let easy: CanonicalCombatKernel | null = null;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      const authoredTimes = new Map(schedule.map((entry) => [
        `${entry.emitter.id}:${entry.burstIndex}`,
        entry.atMs,
      ]));
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.in_between.context_switch"),
        seed: CONTEXT_SWITCH_REPORT_SEED,
        difficulty,
      });
      let left = 0;
      let right = 0;
      for (let tick120 = 1; tick120 <= 1368; tick120 += 1) {
        const prior = new Map(kernel.snapshot().projectiles
          .filter((projectile) => projectile.state === "flight")
          .map((projectile) => [
            `${projectile.instanceId}:${projectile.generation}`,
            projectile.headingDegrees,
          ]));
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        const corridorCenter = safeGapCenter(pattern, tick120 * 1000 / 120);
        for (const projectile of kernel.snapshot().projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            expect(
              Math.abs(projectile.position.x - corridorCenter),
              `${difficulty}:${tick120}:${projectile.instanceId}:${projectile.generation}`,
            ).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2 + projectile.collisionRadiusPx + 2 - 1e-9,
            );
          }
        }
        for (const projectile of kernel.snapshot().projectiles) {
          if (projectile.state !== "flight") continue;
          const previousHeading = prior.get(`${projectile.instanceId}:${projectile.generation}`);
          if (previousHeading === undefined) continue;
          const emitter = pattern.emitters.find((entry) => entry.id === projectile.sourceId);
          const turn = emitter?.motionStack.find((entry) => entry.operator === "op.turn_once");
          const authoredAtMs = authoredTimes.get(`${projectile.sourceId}:${projectile.burstIndex}`);
          let authoredDelta = 0;
          if (turn !== undefined && authoredAtMs !== undefined) {
            const turnTick = crossedTickCount(authoredAtMs + (turn.params.atMs as number))
              - crossedTickCount(authoredAtMs);
            if (tick120 - projectile.spawnedAtTick === turnTick) {
              authoredDelta = turn.params.deltaDeg as number;
            }
          }
          const constraintDelta = projectile.headingDegrees - previousHeading - authoredDelta;
          if (Math.abs(constraintDelta + 8) < 1e-9) left += 1;
          if (Math.abs(constraintDelta - 8) < 1e-9) right += 1;
        }
      }
      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      const candidates = schedule.reduce((total, entry) => total + roundPatternCount(
        entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      ), 0);
      expect({
        candidates,
        rng: kernel.snapshot().rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        impact: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        residues: kernel.snapshot().projectiles.length,
        redirects: {left, right},
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        candidates: expected[difficulty].candidates,
        rng: expected[difficulty].candidates,
        spawn: expected[difficulty].candidates,
        sourceWithdrawn: 0,
        outOfBounds: expected[difficulty].outOfBounds,
        patternEnd: expected[difficulty].patternEnd,
        impact: 0,
        damage: 0,
        residues: expected[difficulty].residues,
        redirects: expected[difficulty].redirects,
        hash: expected[difficulty].hash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1368,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
      });
      expect(kernel.projectilePoolAudit()).toEqual([]);
      if (difficulty === "EASY") easy = kernel;
    }

    expect(easy).not.toBeNull();
    if (easy === null) return;
    const lateIds = easy.events().filter((event) =>
      event.tick120 === 1368 && event.id === "projectile.spawn.commit")
      .map((event) => event.entityStableId);
    expect(lateIds).toHaveLength(6);
    expect(easy.snapshot().projectiles.filter((projectile) =>
      lateIds.includes(projectile.instanceId))).toEqual(
        expect.arrayContaining(Array.from({length: 6}, () => expect.objectContaining({
          sourceId: "system-a",
          burstIndex: 10,
          spawnedAtTick: 1368,
          armAtTick: 1373,
          state: "residue",
          collisionEnabled: false,
          terminalCause: "cancel",
          movedAtTick120: null,
        }))),
      );
    for (const id of lateIds) {
      expect(easy.events().filter((event) =>
        event.tick120 === 1368 && event.entityStableId === id).map((event) => event.id)).toEqual([
          "projectile.collision.off",
          "projectile.arm.begin",
          "projectile.cancel.commit",
          "projectile.residue.begin",
          "projectile.spawn.commit",
        ]);
      expect(easy.events().some((event) =>
        event.tick120 === 1368
        && event.entityStableId === id
        && event.id === "projectile.collision.on")).toBe(false);
    }
    for (let tick120 = 1369; tick120 <= 1745; tick120 += 1) {
      easy.step(safeGapFollowingInput(easy, pattern, tick120));
    }
    expect(easy.snapshot()).toMatchObject({
      tick120: 1745,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    easy.step(safeGapFollowingInput(easy, pattern, 1746));
    expect(easy.snapshot()).toMatchObject({
      tick120: 1746,
      projectiles: [],
      projectileLifecycleDrained: true,
      handoffReady: true,
    });
    expect(easy.events().filter((event) =>
      event.tick120 === 1746
      && event.id === "projectile.residue.remove"
      && lateIds.includes(event.entityStableId))).toHaveLength(6);
  });

  it("retains Context colliders through graze/contact and feeds ordered redirect paths to Override", () => {
    const graze = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.context_switch"),
      seed: CONTEXT_SWITCH_REPORT_SEED,
      initialPlayerPosition: {x: 120, y: 76.8},
    });
    for (let tick120 = 1; tick120 <= 93; tick120 += 1) {
      graze.step({tick120, movement: {x: 0, y: 0}, focused: false});
    }
    expect(graze.snapshot()).toMatchObject({
      player: {health: 3},
      evidence: {amount: 8},
      lastDamageBatch: null,
    });
    expect(graze.events().filter((event) =>
      event.tick120 === 93 && event.id === "projectile.graze.commit")).toHaveLength(8);

    const impact = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.context_switch"),
      seed: CONTEXT_SWITCH_REPORT_SEED,
      initialPlayerPosition: {x: 108.927743767166, y: 77.58712723257577},
    });
    for (let tick120 = 1; tick120 <= 93; tick120 += 1) {
      impact.step({tick120, movement: {x: 0, y: 0}, focused: false});
    }
    expect(impact.snapshot()).toMatchObject({
      player: {health: 2, collisionEnabled: false},
      lastDamageBatch: {
        tick120: 93,
        committedSourceId: "combat:room.in_between.context_switch/micro/0000:0",
        branch: "non-fatal",
      },
    });
    expect(impact.events().filter((event) => event.tick120 === 93).map((event) => event.id))
      .toEqual([
        "projectile.collision.off",
        "player.collision.off",
        "projectile.impact.commit",
        "projectile.residue.begin",
        "player.damage.commit",
        "player.invulnerability.begin",
      ]);

    const pattern = executablePattern("room.in_between.context_switch");
    const override = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.context_switch"),
      seed: CONTEXT_SWITCH_REPORT_SEED,
      grazeRadiusPx: 1000,
    });
    const directionRadians = -65 * Math.PI / 180;
    for (let tick120 = 1; tick120 <= 368; tick120 += 1) {
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, tick120 * 1000 / 120);
      const currentX = override.snapshot().playerPosition.x;
      override.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
        ...(tick120 === 296
          ? {overridePressed: true, overrideDirection: {
              x: Math.cos(directionRadians),
              y: Math.sin(directionRadians),
            }}
          : {}),
      });
    }
    const redirectedId = "combat:room.in_between.context_switch/micro/0013";
    const redirected = override.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === redirectedId && projectile.generation === 0);
    expect(redirected).toMatchObject({
      state: "residue",
      terminalCause: "cancel",
      collisionEnabled: false,
      movedAtTick120: 368,
      headingDegrees: 93.81360635721684,
      position: {x: 204.061812286306, y: 475.8121765994746},
    });
    expect(override.events().filter((event) =>
      event.tick120 === 368
      && event.entityStableId === redirectedId
      && event.id === "projectile.cancel.commit"
      && event.payload.reason === "override_void")).toHaveLength(1);
    expect(override.events().some((event) =>
      event.tick120 === 368
      && event.entityStableId === redirectedId
      && event.id === "projectile.impact.commit")).toBe(false);
    for (let tick120 = 369; tick120 <= 452; tick120 += 1) {
      override.step(safeGapFollowingInput(override, pattern, tick120));
    }
    expect(override.events().find((event) =>
      event.tick120 === 452
      && event.id === "cross_run.scar.write.commit"
      && Array.isArray(event.payload.cancellations)
      && event.payload.cancellations.some((entry) =>
        entry.projectileId === redirectedId && entry.projectileGeneration === 0)))
      .toMatchObject({
        payload: {
          x: redirected?.position.x,
          y: redirected?.position.y,
          cancellations: [{
            projectileId: redirectedId,
            projectileGeneration: 0,
            x: redirected?.position.x,
            y: redirected?.position.y,
          }],
        },
      });
  });

  it("keeps motion and event identity relative to a nonzero occurrence start", () => {
    const pattern = executablePattern("room.in_between.context_switch");
    const offsetTick120 = 401;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.context_switch"),
      seed: CONTEXT_SWITCH_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.context_switch"),
      seed: CONTEXT_SWITCH_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number) => {
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120: kernel.snapshot().startTick120 + relativeTick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 420; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
  });

  it("stays trace-identical at 30/60/144Hz, backlog, and presentation profiles", {
    timeout: 10000,
  }, () => {
    const targetTick120 = 420;
    const durationMs = targetTick120 * 1000 / 120;
    const baseline = driveContextSwitchWithDeltas(
      Array.from({length: 105}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveContextSwitchWithDeltas(
        Array.from({length: 210}, () => 1000 / 60),
        targetTick120,
        0,
        "reduced-motion/flash-off/sleet",
      ),
      driveContextSwitchWithDeltas(
        Array.from({length: 504}, () => 1000 / 144),
        targetTick120,
        0,
        "full-motion/flash-off/ash",
      ),
      driveContextSwitchWithDeltas(
        [durationMs],
        targetTick120,
        0,
        "reduced-motion/default-flash/clear-weather",
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated Ballot Shift combat capability", () => {
  it("pins the exact V4 contract, explicit phase adapter, and separate Python-oracle evidence", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateBallotShiftPatternContract(contract)).not.toThrow();
    expect(contract).toMatchObject({
      id: "room.forced.ballot_shift",
      category: "ROOM",
      room: "FORCED_ALIGNMENT",
      durationMs: 12000,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 591, event: "collision.arm"},
        {atMs: 591, event: "emit.begin"},
        {atMs: 6000, event: "pattern.midpoint"},
        {atMs: 11300, event: "emit.end"},
        {atMs: 11580, event: "residue.commit"},
        {atMs: 12000, event: "pattern.complete"},
      ],
      safeGap: {
        type: "lane_switch",
        minimumWidthPx: 40,
        focusMinimumWidthPx: 32,
        enforcement: "phase_gate",
        path: {
          centerX: 180,
          amplitudePx: 0,
          periodMs: 5200,
          phase: 0,
          laneX: [112, 248],
          maxTravelPxPerSec: 78,
        },
      },
      warning: {durationMs: 591, shape: "two_clock_lane_preview"},
      residue: {type: "seam_filament", lifetimeMs: 2579, density: 0.39},
      seed: {base: 1912172135},
      emitters: [
        expect.objectContaining({
          id: "ballot-a",
          anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
          geometry: expect.objectContaining({
            type: "line", variant: "clock-a-columns", count: 10,
            baseAngleDeg: 90, spreadDeg: 0,
          }),
          cadence: {startMs: 591, intervalMs: 700, bursts: 15, intraBurstMs: 0},
          motionStack: [
            {
              operator: "op.dual_clock_gate",
              params: {
                periodAMs: 1400, periodBMs: 2100, dutyA: 0.52, dutyB: 0.38,
                phaseOffsetMs: 0,
              },
            },
            {operator: "op.linear", params: {}},
          ],
        }),
        expect.objectContaining({
          id: "ballot-b",
          anchor: {space: "viewport-normalized", x: 0.5, y: 0.14},
          geometry: expect.objectContaining({
            type: "arc", variant: "clock-b-counterclaim", count: 7,
            baseAngleDeg: 90, spreadDeg: 92,
          }),
          cadence: {startMs: 941, intervalMs: 1050, bursts: 10, intraBurstMs: 0},
          motionStack: [
            {
              operator: "op.dual_clock_gate",
              params: {
                periodAMs: 2100, periodBMs: 1400, dutyA: 0.38, dutyB: 0.52,
                phaseOffsetMs: 350,
              },
            },
            {operator: "op.linear", params: {}},
          ],
        }),
      ],
    });
    expect(kernel.snapshot().adapterGaps.ballotPhaseGate).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      clockIdentity: "pattern-relative-integer-tick120",
      effectiveGate: "dual-clock-xor-plus-continuous-lane-collision-mask",
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off",
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick",
      phaseGapBehavior: "same-generation-motion-retained-collision-off",
      collisionLease: "reversible-entity-owned-canonical-events",
      overridePolicy: "masked-digital-body-remains-cancellable",
      completeTickTie: "pattern-end-cancels-before-same-tick-arm",
    });

    const expected = {
      EASY: [25, 170, 26, "9f15f2c2f25e33dcf39b3ff6899bfadf30117edaf8306ccb3e6e4bc801bb9347"],
      NORMAL: [25, 220, 33, "459fe4a07f64f7042b5ef4b8587d8748aabdd75c2c39362c7abf37ecfc00280d"],
      HARD: [25, 260, 55, "cbd63efb52c1699a7fb1cf9a5359cecd33639157e44784eb482c0107639afc49"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: BALLOT_SHIFT_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: BALLOT_SHIFT_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expected[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("fails closed on hostile Ballot source and dual-clock parameter shapes", () => {
    const source = structuredClone(executablePattern("room.forced.ballot_shift")) as unknown as {
      safeGap: {enforcement: string};
      emitters: Array<{motionStack: Array<{operator: string; params: Record<string, unknown>}>}>;
      metadata?: string;
    };
    expect(() => validateBallotShiftPatternContract(source)).not.toThrow();
    expect(() => validateBallotShiftPatternContract({...source, metadata: "write-back"}))
      .toThrow(/keys|contract/);
    const gapDrift = structuredClone(source);
    gapDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateBallotShiftPatternContract(gapDrift)).toThrow(/authored contract/);
    const emitterOrder = structuredClone(source);
    emitterOrder.emitters.reverse();
    expect(() => validateBallotShiftPatternContract(emitterOrder)).toThrow(/ballot-a|emitter/);
    const motionOrder = structuredClone(source);
    motionOrder.emitters[0]!.motionStack.reverse();
    expect(() => validateBallotShiftPatternContract(motionOrder))
      .toThrow(/motion stack|emitter|dual_clock_gate/);
    const extraParameter = structuredClone(source);
    extraParameter.emitters[1]!.motionStack[0]!.params.presentationSeed = 7;
    expect(() => validateBallotShiftPatternContract(extraParameter)).toThrow(/keys|contract/);

    expect(() => validateDualClockGateParameters({
      periodAMs: 1400,
      periodBMs: 2100,
      dutyA: 0.52,
      dutyB: 0.38,
      phaseOffsetMs: 0,
    })).not.toThrow();
    for (const params of [
      {periodAMs: 0, periodBMs: 2100, dutyA: 0.52, dutyB: 0.38, phaseOffsetMs: 0},
      {periodAMs: 1400, periodBMs: 2100, dutyA: 0, dutyB: 0.38, phaseOffsetMs: 0},
      {periodAMs: 1400, periodBMs: 2100, dutyA: 0.52, dutyB: 1.1, phaseOffsetMs: 0},
      {periodAMs: 1400, periodBMs: 2100, dutyA: 0.52, dutyB: 0.38, phaseOffsetMs: -1},
      {
        periodAMs: 1400, periodBMs: 2100, dutyA: 0.52, dutyB: 0.38,
        phaseOffsetMs: 0, rendererClock: true,
      },
    ]) expect(() => validateDualClockGateParameters(params)).toThrow();

    let reads = 0;
    const accessor = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        reads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateBallotShiftPatternContract(accessor)).toThrow(/own data property/);
    expect(reads).toBe(0);
  });

  it("keeps authored cadence ties and the EASY late arm/completion boundary", () => {
    const pattern = executablePattern("room.forced.ballot_shift");
    const expectedCandidates = {EASY: 170, NORMAL: 220, HARD: 260} as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule).toHaveLength(25);
      expect(schedule.reduce((total, entry) => total + roundPatternCount(
        entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      ), 0)).toBe(expectedCandidates[difficulty]);
    }
    const normal = createPatternSchedule(pattern, "NORMAL");
    expect(normal.filter((entry) => entry.atMs === 1991)
      .map((entry) => [entry.emitter.id, entry.burstIndex])).toEqual([
        ["ballot-a", 2],
        ["ballot-b", 1],
      ]);
    expect(normal.filter((entry) => [1991, 4091, 6191, 8291, 10391].includes(entry.atMs))
      .map((entry) => entry.emitter.id)).toEqual([
        "ballot-a", "ballot-b", "ballot-a", "ballot-b", "ballot-a",
        "ballot-b", "ballot-a", "ballot-b", "ballot-a", "ballot-b",
      ]);

    const easy = createPatternSchedule(pattern, "EASY");
    const lateB = easy.find((entry) => entry.emitter.id === "ballot-b" && entry.burstIndex === 9);
    const lateA = easy.find((entry) => entry.emitter.id === "ballot-a" && entry.burstIndex === 14);
    expect(lateB?.atMs).toBe(11903);
    expect(crossedTickCount(lateB?.atMs ?? Number.NaN)).toBe(1429);
    expect(crossedTickCount((lateB?.atMs ?? 0) + 40)).toBe(1434);
    expect(lateA?.atMs).toBe(11959);
    expect(crossedTickCount(lateA?.atMs ?? Number.NaN)).toBe(1436);
    expect(crossedTickCount((lateA?.atMs ?? 0) + 40)).toBe(1440);
    expect(crossedTickCount(pattern.durationMs)).toBe(1440);
  });

  it("pins pattern-global clock openings, stationary transition ticks, and atomic lease append", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
    });
    const samples = new Map<number, ReturnType<CanonicalCombatKernel["snapshot"]>>();
    for (let tick120 = 1; tick120 <= 214; tick120 += 1) {
      kernel.step({...inputAt(tick120), focused: false});
      if ([76, 87, 88, 89, 95, 96, 118, 125, 126, 127, 213, 214].includes(tick120)) {
        samples.set(tick120, kernel.snapshot());
      }
    }
    const projectileAt = (tick120: number, sourceId: string) =>
      samples.get(tick120)?.projectiles.find((projectile) =>
        projectile.sourceId === sourceId
        && projectile.burstIndex === 0
        && projectile.sourceIndex === 0);
    expect(projectileAt(76, "ballot-a")).toMatchObject({
      state: "flight", collisionEnabled: false, speedPxPerSecond: 0, position: {y: 102.4},
    });
    expect(projectileAt(76, "ballot-a")?.position.x).toBeCloseTo(32.4, 12);
    expect(projectileAt(87, "ballot-a")).toMatchObject({
      collisionEnabled: false, speedPxPerSecond: 0, position: {y: 102.4},
    });
    expect(projectileAt(88, "ballot-a")).toMatchObject({
      collisionEnabled: true, speedPxPerSecond: 0, position: {y: 102.4},
    });
    expect(projectileAt(89, "ballot-a")).toMatchObject({
      collisionEnabled: true, speedPxPerSecond: 158,
    });
    expect(projectileAt(89, "ballot-a")?.position.y).toBeCloseTo(103.71666666666667, 12);
    expect(projectileAt(96, "ballot-a")).toMatchObject({
      collisionEnabled: false, speedPxPerSecond: 0,
    });
    expect(projectileAt(96, "ballot-a")?.position).toEqual(
      projectileAt(95, "ballot-a")?.position,
    );
    expect(projectileAt(118, "ballot-b")).toMatchObject({
      state: "flight", collisionEnabled: false, speedPxPerSecond: 0, position: {x: 180},
    });
    expect(projectileAt(118, "ballot-b")?.position.y).toBeCloseTo(89.6, 12);
    expect(projectileAt(126, "ballot-b")).toMatchObject({
      collisionEnabled: true, speedPxPerSecond: 0, position: {x: 180},
    });
    expect(projectileAt(126, "ballot-b")?.position.y).toBeCloseTo(89.6, 12);
    expect(projectileAt(127, "ballot-b")).toMatchObject({
      collisionEnabled: true, speedPxPerSecond: 176,
    });
    expect(projectileAt(214, "ballot-b")).toMatchObject({
      collisionEnabled: false, speedPxPerSecond: 0,
    });
    expect(projectileAt(214, "ballot-b")?.position).toEqual(
      projectileAt(213, "ballot-b")?.position,
    );
    expect(kernel.events().filter((event) =>
      event.entityStableId === "combat:room.forced.ballot_shift/micro/0000"
      && (event.id === "projectile.collision.on" || event.id === "projectile.collision.off"))
      .map((event) => [event.tick120, event.id, event.payload.reason ?? null])).toEqual([
        [88, "projectile.collision.on", null],
        [96, "projectile.collision.off", "dual_clock_gate"],
        [168, "projectile.collision.on", null],
      ]);

    const hostileBus = new CanonicalEventBus();
    const hostile = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
    }, hostileBus);
    for (let tick120 = 1; tick120 <= 87; tick120 += 1) {
      hostile.step({...inputAt(tick120), focused: false});
    }
    hostileBus.enqueue({
      id: "projectile.collision.on",
      tick120: 88,
      entityStableId: "combat:room.forced.ballot_shift/micro/0001",
      localSequence: 4,
      occurrenceKey: "combat:room.forced.ballot_shift/micro/0001:0:collision-gate:0:on",
      payload: {
        instanceId: "combat:room.forced.ballot_shift/micro/0001",
        generation: 0,
      },
    });
    expect(() => hostile.step({...inputAt(88), focused: false}))
      .toThrow(/duplicate authoritative occurrence key/);
    expect(hostile.snapshot().projectiles.filter((projectile) =>
      projectile.sourceId === "ballot-a" && projectile.burstIndex === 0))
      .toHaveLength(10);
    expect(hostile.snapshot().projectiles.filter((projectile) =>
      projectile.sourceId === "ballot-a"
      && projectile.burstIndex === 0
      && projectile.collisionEnabled)).toHaveLength(0);
  });

  it("retains linear motion under the phase mask and closes every contact hole on re-enable", () => {
    const pattern = executablePattern("room.forced.ballot_shift");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
    });
    const targetId = "combat:room.forced.ballot_shift/micro/0006";
    const samples = new Map<number, ReturnType<CanonicalCombatKernel["snapshot"]>>();
    for (let tick120 = 1; tick120 <= 800; tick120 += 1) {
      kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      if ([704, 705, 706, 798, 799, 800].includes(tick120)) {
        samples.set(tick120, kernel.snapshot());
      }
    }
    const targetAt = (tick120: number) => samples.get(tick120)?.projectiles.find((projectile) =>
      projectile.instanceId === targetId && projectile.generation === 0);
    expect(targetAt(704)).toMatchObject({
      state: "flight", collisionEnabled: true, speedPxPerSecond: 158,
    });
    expect(targetAt(705)).toMatchObject({
      state: "flight", collisionEnabled: false, speedPxPerSecond: 158,
      movedAtTick120: 705,
    });
    expect(targetAt(705)?.position.y).toBeCloseTo(476.3333333333323, 10);
    expect(targetAt(706)).toMatchObject({
      state: "flight", collisionEnabled: false, speedPxPerSecond: 158,
      movedAtTick120: 706,
    });
    expect((targetAt(706)?.position.y ?? 0) - (targetAt(705)?.position.y ?? 0))
      .toBeCloseTo(158 / 120, 12);
    expect(targetAt(798)).toMatchObject({
      state: "flight", collisionEnabled: false, speedPxPerSecond: 158,
      generation: 0,
    });
    expect(targetAt(799)).toMatchObject({
      state: "flight", collisionEnabled: true, speedPxPerSecond: 158,
      generation: 0,
    });
    expect((targetAt(799)?.position.y ?? 0) - (targetAt(798)?.position.y ?? 0))
      .toBeCloseTo(158 / 120, 12);
    expect(kernel.events().filter((event) =>
      event.entityStableId === targetId
      && event.tick120 >= 705
      && event.tick120 <= 799
      && (
        event.id === "projectile.spawn.commit"
        || event.id === "projectile.cancel.commit"
        || event.id === "projectile.residue.begin"
      ))).toHaveLength(0);
    expect(kernel.events().filter((event) =>
      event.entityStableId === targetId
      && (event.id === "projectile.collision.on" || event.id === "projectile.collision.off"))
      .slice(-2)
      .map((event) => [event.tick120, event.id, event.payload.reason ?? null])).toEqual([
        [705, "projectile.collision.off", "phase_gate"],
        [799, "projectile.collision.on", null],
      ]);

    const contact = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
      initialPlayerPosition: {x: 229.2, y: 593.5166666666688},
    });
    for (let tick120 = 1; tick120 <= 800; tick120 += 1) {
      contact.step({tick120, movement: {x: 0, y: 0}, focused: false});
    }
    expect(contact.events().some((event) =>
      event.tick120 === 799
      && event.entityStableId === targetId
      && (event.id === "projectile.impact.commit" || event.id === "projectile.graze.commit")))
      .toBe(false);
    expect(contact.snapshot()).toMatchObject({
      player: {health: 2, collisionEnabled: false},
      lastDamageBatch: {
        tick120: 800,
        committedSourceId: `${targetId}:0`,
        branch: "non-fatal",
      },
    });
    expect(contact.events().filter((event) => event.tick120 === 800).map((event) => event.id))
      .toEqual([
        "projectile.collision.off",
        "player.collision.off",
        "projectile.impact.commit",
        "projectile.residue.begin",
        "player.damage.commit",
        "player.invulnerability.begin",
      ]);
  });

  it("lets a collision-masked digital body enter Override and writes its exact terminal scar", () => {
    const targetId = "combat:room.forced.ballot_shift/micro/0006";
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
      grazeRadiusPx: 1000,
      initialPlayerPosition: {x: 229.2, y: 500},
    });
    let maskedPosition: Readonly<{x: number; y: number}> | null = null;
    for (let tick120 = 1; tick120 <= 790; tick120 += 1) {
      kernel.step({
        tick120,
        movement: {x: 0, y: 0},
        focused: false,
        ...(tick120 === 634
          ? {overridePressed: true, overrideDirection: {x: 0, y: -1}}
          : {}),
      });
      if (tick120 === 705) {
        const target = kernel.snapshot().projectiles.find((projectile) =>
          projectile.instanceId === targetId && projectile.generation === 0);
        expect(target).toMatchObject({
          state: "flight", collisionEnabled: false, speedPxPerSecond: 158,
          movedAtTick120: 705,
        });
        maskedPosition = target?.position ?? null;
      }
    }
    const target = kernel.snapshot().projectiles.find((projectile) =>
      projectile.instanceId === targetId && projectile.generation === 0);
    expect(target).toMatchObject({
      state: "residue",
      collisionEnabled: false,
      terminalCause: "cancel",
      movedAtTick120: 705,
      position: maskedPosition,
    });
    expect(kernel.events().filter((event) =>
      event.tick120 === 706 && event.entityStableId === targetId).map((event) => [
        event.id,
        event.payload.reason ?? null,
      ])).toEqual([
        ["projectile.collision.off", "override_void"],
        ["projectile.cancel.commit", "override_void"],
        ["projectile.residue.begin", null],
      ]);
    expect(kernel.events().some((event) =>
      event.entityStableId === targetId && event.id === "projectile.impact.commit")).toBe(false);
    expect(kernel.events().find((event) =>
      event.tick120 === 790
      && event.id === "cross_run.scar.write.commit"
      && Array.isArray(event.payload.cancellations)
      && event.payload.cancellations.some((entry) =>
        entry.projectileId === targetId && entry.projectileGeneration === 0)))
      .toMatchObject({
        payload: {
          x: maskedPosition?.x,
          y: maskedPosition?.y,
          cancellations: [{
            projectileId: targetId,
            projectileGeneration: 0,
            x: maskedPosition?.x,
            y: maskedPosition?.y,
          }],
        },
      });
  });

  it("retains every E/N/H identity, protects the lane corridor, and pins production traces", {
    timeout: 20000,
  }, () => {
    const pattern = executablePattern("room.forced.ballot_shift");
    const expected = {
      EASY: {
        candidates: 170, armed: 162, on: 1010, off: 1140,
        dualOff: 947, phaseOff: 23, outOfBounds: 40, patternEnd: 130,
        removed: 6, activeResidue: 164, allocated: 164,
        hash: "4ed653e2f043eddd47c3488bae6428c7ddcd3d9c0a6015cda2f7bfca692548fb",
      },
      NORMAL: {
        candidates: 220, armed: 220, on: 1488, off: 1636,
        dualOff: 1386, phaseOff: 30, outOfBounds: 72, patternEnd: 148,
        removed: 15, activeResidue: 205, allocated: 213,
        hash: "7d15af539bf24e1da5174ac29abbd4f81f2adbd018b9017b776a17921f097d3b",
      },
      HARD: {
        candidates: 260, armed: 260, on: 1738, off: 1842,
        dualOff: 1533, phaseOff: 49, outOfBounds: 156, patternEnd: 104,
        removed: 46, activeResidue: 214, allocated: 252,
        hash: "54c5ddcebe8adb79e603478ee1fa20a9cf03b744297bb04e01cc797b2b3d763f",
      },
    } as const;
    let easyKernel: CanonicalCombatKernel | null = null;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.forced.ballot_shift"),
        seed: BALLOT_SHIFT_REPORT_SEED,
        difficulty,
      });
      let snapshot = kernel.snapshot();
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      for (let tick120 = 1; tick120 <= 1440; tick120 += 1) {
        const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
        const centerX = safeGapCenter(pattern, tick120 * 1000 / 120);
        snapshot = kernel.step({
          tick120,
          movement: {
            x: Math.max(
              -1,
              Math.min(1, (centerX - snapshot.playerPosition.x) / maximumTravel),
            ),
            y: 0,
          },
          focused: false,
        });
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state !== "flight"
            || !projectile.collisionEnabled
            || projectile.position.y < 476
            || projectile.position.y > 622
          ) continue;
          minimumCollisionMargin = Math.min(
            minimumCollisionMargin,
            Math.abs(projectile.position.x - centerX)
              - (
                safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
              ),
          );
        }
      }
      const events = kernel.events();
      const eventCount = (id: string) => events.filter((event) => event.id === id).length;
      const offReasonCount = (reason: string) => events.filter((event) =>
        event.id === "projectile.collision.off" && event.payload.reason === reason).length;
      expect(snapshot).toMatchObject({
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        rngCallsConsumed: facts.candidates,
        player: {health: 3},
        evidence: {amount: 0},
        poolUsage: {
          allocatedSlots: {micro: facts.allocated},
          liveColliders: 0,
          residueVisuals: facts.activeResidue,
        },
      });
      expect(snapshot.projectiles).toHaveLength(facts.activeResidue);
      expect(snapshot.projectiles.every((projectile) =>
        projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect({
        spawn: eventCount("projectile.spawn.commit"),
        armed: eventCount("projectile.armed"),
        on: eventCount("projectile.collision.on"),
        off: eventCount("projectile.collision.off"),
        dualOff: offReasonCount("dual_clock_gate"),
        phaseOff: offReasonCount("phase_gate"),
        outOfBounds: offReasonCount("out_of_bounds"),
        patternEnd: offReasonCount("pattern_end"),
        cancel: eventCount("projectile.cancel.commit"),
        removed: eventCount("projectile.residue.remove"),
      }).toEqual({
        spawn: facts.candidates,
        armed: facts.armed,
        on: facts.on,
        off: facts.off,
        dualOff: facts.dualOff,
        phaseOff: facts.phaseOff,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        cancel: facts.candidates,
        removed: facts.removed,
      });
      expect(events.some((event) =>
        event.id === "projectile.impact.commit"
        || event.id === "projectile.graze.commit"
        || event.id === "player.damage.commit"
        || (
          event.id === "projectile.collision.off"
          && event.payload.reason === "source_withdrawn"
        ))).toBe(false);
      expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);
      expect(kernel.projectilePoolAudit()).toEqual([]);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.hash);
      if (difficulty === "EASY") easyKernel = kernel;
    }

    expect(easyKernel).not.toBeNull();
    if (easyKernel === null) throw new Error("EASY Ballot kernel was not retained");
    const lateA = easyKernel.snapshot().projectiles.filter((projectile) =>
      projectile.sourceId === "ballot-a" && projectile.burstIndex === 14);
    expect(lateA).toHaveLength(8);
    expect(lateA).toEqual(expect.arrayContaining(Array.from({length: 8}, () =>
      expect.objectContaining({
        state: "residue",
        collisionEnabled: false,
        spawnedAtTick: 1436,
        armAtTick: 1440,
        movedAtTick120: null,
        terminalCause: "cancel",
      }))));
    for (const projectile of lateA) {
      expect(easyKernel.events().filter((event) =>
        event.tick120 === 1440 && event.entityStableId === projectile.instanceId)
        .map((event) => event.id)).toEqual([
          "projectile.collision.off",
          "projectile.cancel.commit",
          "projectile.residue.begin",
        ]);
      expect(easyKernel.events().some((event) =>
        event.entityStableId === projectile.instanceId
        && event.id === "projectile.collision.on")).toBe(false);
    }
    for (let tick120 = 1441; tick120 <= 1749; tick120 += 1) {
      easyKernel.step(safeGapFollowingInput(easyKernel, pattern, tick120));
    }
    expect(easyKernel.snapshot()).toMatchObject({
      tick120: 1749,
      projectileLifecycleDrained: false,
      handoffReady: false,
    });
    easyKernel.step(safeGapFollowingInput(easyKernel, pattern, 1750));
    expect(easyKernel.snapshot()).toMatchObject({
      tick120: 1750,
      projectiles: [],
      projectileLifecycleDrained: true,
      handoffReady: true,
    });
  });

  it("keeps Ballot motion, gate events, and lifecycle relative to a nonzero start", () => {
    const pattern = executablePattern("room.forced.ballot_shift");
    const offsetTick120 = 401;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("room.forced.ballot_shift"),
      seed: BALLOT_SHIFT_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number) => {
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120: kernel.snapshot().startTick120 + relativeTick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 800; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
  });

  it("stays trace-identical at 30/60/144Hz, backlog, and presentation profiles", {
    timeout: 15000,
  }, () => {
    const targetTick120 = 800;
    const durationMs = targetTick120 * 1000 / 120;
    const baseline = driveBallotShiftWithDeltas(
      Array.from({length: 200}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveBallotShiftWithDeltas(
        Array.from({length: 400}, () => 1000 / 60),
        targetTick120,
        0,
        {weatherEvent: "sleet", reducedMotion: true, flashOff: true},
      ),
      driveBallotShiftWithDeltas(
        Array.from({length: 960}, () => 1000 / 144),
        targetTick120,
        0,
        {weatherEvent: "ash", reducedMotion: false, flashOff: true},
      ),
      driveBallotShiftWithDeltas(
        [durationMs],
        targetTick120,
        0,
        {weatherEvent: "clear", reducedMotion: true, flashOff: false},
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated One Sun, One Rule observe-phase combat capability", () => {
  it("pins the exact phase-1 contract, null-laser observe binding, adapter provenance, and QA oracle", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.one_sun_one_rule.phase1"),
      seed: ONE_SUN_ONE_RULE_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateOneSunOneRulePatternContract(contract)).not.toThrow();
    expect(contract).toMatchObject({
      id: "boss.one_sun_one_rule.phase1",
      category: "BOSS",
      room: "FORCED_ALIGNMENT",
      name: {
        zh: "一个太阳一种规则：唯一法令",
        en: "One Sun, One Rule: Single decree",
      },
      durationMs: 11500,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 669, event: "collision.arm"},
        {atMs: 669, event: "emit.begin"},
        {atMs: 5750, event: "pattern.midpoint"},
        {atMs: 10800, event: "emit.end"},
        {atMs: 11080, event: "residue.commit"},
        {atMs: 11500, event: "pattern.complete"},
      ],
      emitters: [{
        id: "one_sun_one_rule-p1-primary",
        kind: "projectile",
        anchor: {space: "viewport-normalized", x: 0.34, y: 0.1},
        geometry: {
          type: "fan",
          variant: "single-decree",
          count: 13,
          baseAngleDeg: 82,
          spreadDeg: 174,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 669, intervalMs: 1158, bursts: 8, intraBurstMs: 0},
        projectile: {
          archetype: "bullet.micro.notch_e",
          collisionRadiusPx: 2,
          armDelayMs: 40,
        },
        speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 142}]},
        motionStack: [
          {operator: "op.turn_once", params: {atMs: 780, deltaDeg: 30}},
          {operator: "op.linear", params: {}},
        ],
      }],
      safeGap: {
        type: "alternating_wedge",
        minimumWidthPx: 33,
        focusMinimumWidthPx: 25,
        enforcement: "operator_constraint",
        path: {
          centerX: 180,
          amplitudePx: 28,
          periodMs: 6800,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
      },
      warning: {
        durationMs: 669,
        shape: "single-decree_swept_union",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      residue: {
        type: "one_sun_one_rule_material_trace",
        lifetimeMs: 2495,
        density: 0.3,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      laserGeometry: "laser.single_decree_sweep",
      resolutionHook: {
        type: "phase_evidence",
        canonicalBossId: "boss.one_sun_one_rule",
        narrativeAlias: "one_sun_one_rule",
        resolutionId: "RULE_INTERRUPTED_BY_SCAR",
        condition: "one_sun_one_rule.phaseEvidence>=1",
        terminalEvent: null,
      },
      seed: {base: 2689489757},
    });
    expect(kernel.snapshot().adapterGaps.oneSunOneRuleConstraint).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      declarationOrder: "turn-on-crossed-tick>linear-sweep>operator-constraint",
      observeBinding: "exact-observe-phase-with-null-laser",
      laserAuthority: "inactive-through-phase1",
      phaseExitAndResolution: "withheld-no-evaluator-no-terminal-events",
      oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees",
    });

    const observe = {
      id: "observe",
      patternId: "boss.one_sun_one_rule.phase1",
      entryCondition: "encounter.begin",
      exitCondition: "one_sun_one_rule.evidence>=1",
      laserGeometry: null,
      spatialLaw: "one_open_half",
    } as const;
    expect(() => validateOneSunOneRuleObserveRigContract(observe)).not.toThrow();
    expect(() => validateBossObservePhaseContract(
      {id: observe.id, patternId: observe.patternId, laserGeometry: observe.laserGeometry},
      observe.patternId,
    )).not.toThrow();
    expect(contract).toMatchObject({laserGeometry: "laser.single_decree_sweep"});
    expect(observe.laserGeometry).toBeNull();

    const expectedOracle = {
      EASY: [8, 80, 24, "99fa2c6102afb147af480adddc03e3c788ca91d6e0f1c382709a084557a8f525"],
      NORMAL: [8, 104, 0, "0407cdec6ed371ecd4b66bf651c5c79e7fd515b50767f6b6fa83847bd9781d6a"],
      HARD: [8, 120, 70, "50c7dbe48fd84ceba68d56a8515326abfadd48be0db998f9f8407ae1bf7657da"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: ONE_SUN_ONE_RULE_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: ONE_SUN_ONE_RULE_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expectedOracle[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("fails closed on pattern or observe-rig drift without invoking hostile accessors", () => {
    const source = structuredClone(executablePattern("boss.one_sun_one_rule.phase1")) as unknown as {
      durationMs: number;
      safeGap: {enforcement: string};
      laserGeometry: string;
      emitters: Array<{
        motionStack: Array<{operator: string; params: Record<string, unknown>}>;
      }>;
      metadata?: string;
    };
    expect(() => validateOneSunOneRulePatternContract(source)).not.toThrow();

    const extra = structuredClone(source);
    extra.metadata = "presentation-write-back";
    expect(() => validateOneSunOneRulePatternContract(extra)).toThrow(/contract drifted/);
    const durationDrift = structuredClone(source);
    durationDrift.durationMs += 1;
    expect(() => validateOneSunOneRulePatternContract(durationDrift)).toThrow(/contract drifted/);
    const enforcementDrift = structuredClone(source);
    enforcementDrift.safeGap.enforcement = "angular_omission";
    expect(() => validateOneSunOneRulePatternContract(enforcementDrift)).toThrow(/contract drifted/);
    const laserDrift = structuredClone(source);
    laserDrift.laserGeometry = "laser.misread_bezier";
    expect(() => validateOneSunOneRulePatternContract(laserDrift)).toThrow(/contract drifted/);
    const motionOrderDrift = structuredClone(source);
    motionOrderDrift.emitters[0]!.motionStack.reverse();
    expect(() => validateOneSunOneRulePatternContract(motionOrderDrift)).toThrow(/contract drifted/);

    let safeGapReads = 0;
    const accessorPattern = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        safeGapReads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateOneSunOneRulePatternContract(accessorPattern))
      .toThrow(/own data property/);
    expect(safeGapReads).toBe(0);
    const revoked = Proxy.revocable(structuredClone(source), {});
    revoked.revoke();
    expect(() => validateOneSunOneRulePatternContract(revoked.proxy)).toThrow();

    const observe = {
      id: "observe",
      patternId: "boss.one_sun_one_rule.phase1",
      entryCondition: "encounter.begin",
      exitCondition: "one_sun_one_rule.evidence>=1",
      laserGeometry: null,
      spatialLaw: "one_open_half",
    } as const;
    expect(() => validateOneSunOneRuleObserveRigContract({
      ...observe,
      laserGeometry: "laser.single_decree_sweep",
    })).toThrow(/rig contract drifted/);
    expect(() => validateOneSunOneRuleObserveRigContract({
      ...observe,
      exitCondition: "one_sun_one_rule.phaseEvidence>=1",
    })).toThrow(/rig contract drifted/);
    expect(() => validateOneSunOneRuleObserveRigContract({...observe, evaluator: true}))
      .toThrow(/keys|contract/);
    let laserReads = 0;
    const accessorObserve = Object.defineProperty({...observe}, "laserGeometry", {
      enumerable: true,
      get() {
        laserReads += 1;
        return null;
      },
    });
    expect(() => validateOneSunOneRuleObserveRigContract(accessorObserve))
      .toThrow(/own data property/);
    expect(laserReads).toBe(0);

    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS).not.toContain("boss.one_sun_one_rule.phase2");
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("boss.one_sun_one_rule.phase1"),
      patternId: "boss.one_sun_one_rule.phase2",
    })).toThrow(/does not yet support pattern/);
  });

  it("preserves exact E/N/H cadence, candidate counts, arm ticks, turn ticks, and drain boundary", () => {
    const pattern = executablePattern("boss.one_sun_one_rule.phase1");
    const expected = {
      EASY: {
        candidates: 80,
        speed: 124.96,
        gap: 41,
        spawn: [81, 242, 403, 564, 726, 887, 1048, 1209],
        arm: [86, 247, 408, 569, 730, 892, 1053, 1214],
        turn: [174, 336, 497, 658, 819, 980, 1142, 1303],
      },
      NORMAL: {
        candidates: 104,
        speed: 142,
        gap: 33,
        spawn: [81, 220, 359, 498, 637, 776, 915, 1053],
        arm: [86, 225, 363, 502, 641, 780, 919, 1058],
        turn: [174, 313, 452, 591, 730, 869, 1008, 1147],
      },
      HARD: {
        candidates: 120,
        speed: 159.04,
        gap: 29,
        spawn: [81, 203, 325, 448, 570, 692, 814, 937],
        arm: [86, 208, 330, 452, 575, 697, 819, 942],
        turn: [174, 297, 419, 541, 664, 786, 908, 1030],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule).toHaveLength(8);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(expected[difficulty].spawn);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 40)))
        .toEqual(expected[difficulty].arm);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 780)))
        .toEqual(expected[difficulty].turn);
      expect(schedule.reduce((total, entry) => total + roundPatternCount(
        entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      ), 0)).toBe(expected[difficulty].candidates);
      expect(pattern.emitters[0]!.speedCurve.keys[0]!.pxPerSec
        * pattern.difficulty[difficulty].speedMultiplier)
        .toBeCloseTo(expected[difficulty].speed, 12);
      expect(safeGapWidth(pattern, difficulty)).toBe(expected[difficulty].gap);
    }
    expect([0, 669, 669, 5750, 10800, 11080, 11500].map(crossedTickCount))
      .toEqual([0, 81, 81, 690, 1296, 1330, 1380]);
    expect(crossedTickCount(pattern.durationMs)).toBe(1380);
    expect(crossedTickCount(2495)).toBe(300);
  });

  it("applies the declared turn before the crossed tick's linear sweep", () => {
    const pattern = executablePattern("boss.one_sun_one_rule.phase1");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("boss.one_sun_one_rule.phase1"),
      seed: ONE_SUN_ONE_RULE_REPORT_SEED,
    });
    const samples = new Map<number, ReturnType<CanonicalCombatKernel["snapshot"]>>();
    for (let tick120 = 1; tick120 <= 174; tick120 += 1) {
      const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      if ([81, 86, 87, 172, 173, 174].includes(tick120)) samples.set(tick120, snapshot);
    }
    const projectileAt = (tick120: number) => {
      const projectile = samples.get(tick120)?.projectiles.find((entry) =>
        entry.sourceId === "one_sun_one_rule-p1-primary"
        && entry.burstIndex === 0
        && entry.sourceIndex === 6);
      expect(projectile, `one-sun source index 6 at ${tick120}`).toBeDefined();
      return projectile as NonNullable<typeof projectile>;
    };
    expect(projectileAt(81)).toMatchObject({
      state: "arm",
      collisionEnabled: false,
      position: {x: 122.4, y: 64},
      spawnedAtTick: 81,
      armAtTick: 86,
      movedAtTick120: null,
    });
    expect(projectileAt(86)).toMatchObject({
      state: "flight",
      collisionEnabled: true,
      position: {x: 122.4, y: 64},
      movedAtTick120: null,
    });
    const spawn = projectileAt(81);
    const firstMove = projectileAt(87);
    expect(firstMove.position.x - spawn.position.x).toBeCloseTo(0.15535337616325, 12);
    expect(firstMove.position.y - spawn.position.y).toBeCloseTo(1.17309126085418, 12);

    const beforeOldSweep = projectileAt(172);
    const afterOldSweep = projectileAt(173);
    const afterTurnSweep = projectileAt(174);
    expect(afterOldSweep.position.x - beforeOldSweep.position.x)
      .toBeCloseTo(0.15535337616325, 12);
    expect(afterOldSweep.position.y - beforeOldSweep.position.y)
      .toBeCloseTo(1.17309126085418, 12);
    expect(afterOldSweep.headingDegrees).toBeCloseTo(82.4561725452263, 12);
    expect(afterTurnSweep.headingDegrees - afterOldSweep.headingDegrees).toBeCloseTo(30, 12);
    expect(afterTurnSweep.position.x - afterOldSweep.position.x)
      .toBeCloseTo(-0.45200566010604, 12);
    expect(afterTurnSweep.position.y - afterOldSweep.position.y)
      .toBeCloseTo(1.09360352093888, 12);
    expect(afterTurnSweep.position.x).toBeCloseTo(
      afterOldSweep.position.x
        + Math.cos(afterTurnSweep.headingDegrees * Math.PI / 180)
        * afterTurnSweep.speedPxPerSecond / 120,
      12,
    );
    expect(afterTurnSweep.position.y).toBeCloseTo(
      afterOldSweep.position.y
        + Math.sin(afterTurnSweep.headingDegrees * Math.PI / 180)
        * afterTurnSweep.speedPxPerSecond / 120,
      12,
    );
  });

  it("retains every authored identity, continuously constrains the corridor, and drains exactly across E/N/H", {
    timeout: 30_000,
  }, () => {
    const pattern = executablePattern("boss.one_sun_one_rule.phase1");
    const lifecycleIds = [
      "projectile.arm.begin",
      "projectile.armed",
      "projectile.cancel.commit",
      "projectile.collision.off",
      "projectile.collision.on",
      "projectile.flight.begin",
      "projectile.lifecycle.complete",
      "projectile.residue.begin",
      "projectile.residue.remove",
      "projectile.spawn.commit",
    ] as const;
    const expected = {
      EASY: {
        candidates: 80,
        redirects: 25,
        redirectLeft: 0,
        redirectRight: 25,
        redirectIdentities: 2,
        outOfBounds: 57,
        patternEnd: 23,
        removed: 40,
        activeResidue: 40,
        allocated: 51,
        peakLive: 32,
        peakResidue: 40,
        endHash: "9053899fdb5c5feba0640d0f3b6af3f994e4102449fbdcea5ce16085a342b6ca",
        fullHash: "69bbfde0de194f312a95b5afbc1815823de255f8f4846fb207ce7d375c29a14e",
      },
      NORMAL: {
        candidates: 104,
        redirects: 24,
        redirectLeft: 0,
        redirectRight: 24,
        redirectIdentities: 1,
        outOfBounds: 88,
        patternEnd: 16,
        removed: 62,
        activeResidue: 42,
        allocated: 70,
        peakLive: 44,
        peakResidue: 42,
        endHash: "038426d85d5245616d296102b190d8bb0d6fcea1f21179ea1d75507d354d46ee",
        fullHash: "25c9537a69207463340e4b217fc04ab70607ddfcb15b8e9eaf4a808ecc57c96e",
      },
      HARD: {
        candidates: 120,
        redirects: 72,
        redirectLeft: 22,
        redirectRight: 50,
        redirectIdentities: 5,
        outOfBounds: 111,
        patternEnd: 9,
        removed: 85,
        activeResidue: 35,
        allocated: 86,
        peakLive: 50,
        peakResidue: 40,
        endHash: "6cc6bc61700eb53e2be00e6f790d331975a164b088d73f6307bf0ca18fac933c",
        fullHash: "467642eb04139d0aaafb8c87f790a1c4b7a06aefed75f3db5656a60f92134a3e",
      },
    } as const;

    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const schedule = createPatternSchedule(pattern, difficulty);
      const turnAgeByBurst = new Map(schedule.map((entry) => [
        entry.burstIndex,
        crossedTickCount(entry.atMs + 780) - crossedTickCount(entry.atMs),
      ]));
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("boss.one_sun_one_rule.phase1"),
        seed: ONE_SUN_ONE_RULE_REPORT_SEED,
        difficulty,
      });
      let redirects = 0;
      let redirectLeft = 0;
      let redirectRight = 0;
      const redirectIdentities = new Set<string>();
      let peakLive = 0;
      let peakResidue = 0;
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      for (let tick120 = 1; tick120 <= 1380; tick120 += 1) {
        const priorHeadings = new Map(kernel.snapshot().projectiles
          .filter((projectile) => projectile.state === "flight")
          .map((projectile) => [
            `${projectile.instanceId}:${projectile.generation}`,
            projectile.headingDegrees,
          ]));
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        peakLive = Math.max(peakLive, snapshot.poolUsage.liveColliders);
        peakResidue = Math.max(peakResidue, snapshot.poolUsage.residueVisuals);
        const corridorCenter = safeGapCenter(pattern, tick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state === "flight"
            && projectile.collisionEnabled
            && projectile.position.y >= 476
            && projectile.position.y <= 622
          ) {
            minimumCollisionMargin = Math.min(
              minimumCollisionMargin,
              Math.abs(projectile.position.x - corridorCenter) - (
                safeGapWidth(pattern, difficulty) / 2
                + projectile.collisionRadiusPx
                + 2
              ),
            );
          }
          if (projectile.state !== "flight") continue;
          const identity = `${projectile.instanceId}:${projectile.generation}`;
          const previousHeading = priorHeadings.get(identity);
          if (previousHeading === undefined) continue;
          const turnAge = turnAgeByBurst.get(projectile.burstIndex);
          const authoredTurn = turnAge !== undefined
            && tick120 - projectile.spawnedAtTick === turnAge
            ? 30
            : 0;
          const constraintTurn = projectile.headingDegrees - previousHeading - authoredTurn;
          if (Math.abs(Math.abs(constraintTurn) - 8) < 1e-9) {
            redirects += 1;
            if (constraintTurn < 0) redirectLeft += 1;
            else redirectRight += 1;
            redirectIdentities.add(identity);
          } else {
            expect(constraintTurn).toBeCloseTo(0, 9);
          }
        }
      }

      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      const spawnIdentities = new Set(events
        .filter((event) => event.id === "projectile.spawn.commit")
        .map((event) => `${event.entityStableId}:${String(event.payload.generation)}`));
      expect([...new Set(events.map((event) => event.id))].sort()).toEqual(lifecycleIds);
      expect(events.every((event) => spawnIdentities.has(
        `${event.entityStableId}:${String(event.payload.generation)}`,
      ))).toBe(true);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect({
        candidates: schedule.reduce((total, entry) => total + roundPatternCount(
          entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
        ), 0),
        rng: kernel.snapshot().rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        flight: count("projectile.flight.begin"),
        armed: count("projectile.armed"),
        collisionOn: count("projectile.collision.on"),
        collisionOff: count("projectile.collision.off"),
        cancel: count("projectile.cancel.commit"),
        residue: count("projectile.residue.begin"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        removed: count("projectile.residue.remove"),
        activeResidue: kernel.snapshot().projectiles.length,
        allocated: kernel.snapshot().poolUsage.allocatedSlots.micro,
        peakLive,
        peakResidue,
        redirects,
        redirectLeft,
        redirectRight,
        redirectIdentities: redirectIdentities.size,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        candidates: facts.candidates,
        rng: facts.candidates,
        spawn: facts.candidates,
        flight: facts.candidates,
        armed: facts.candidates,
        collisionOn: facts.candidates,
        collisionOff: facts.candidates,
        cancel: facts.candidates,
        residue: facts.candidates,
        sourceWithdrawn: 0,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        removed: facts.removed,
        activeResidue: facts.activeResidue,
        allocated: facts.allocated,
        peakLive: facts.peakLive,
        peakResidue: facts.peakResidue,
        redirects: facts.redirects,
        redirectLeft: facts.redirectLeft,
        redirectRight: facts.redirectRight,
        redirectIdentities: facts.redirectIdentities,
        hash: facts.endHash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1380,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
        player: {health: 3},
        evidence: {amount: 0},
        poolUsage: {liveColliders: 0, residueVisuals: facts.activeResidue},
      });
      expect(kernel.projectilePoolAudit()).toEqual([]);

      for (let tick120 = 1381; tick120 <= 1679; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1679,
        projectileLifecycleDrained: false,
        handoffReady: false,
      });
      expect(kernel.snapshot().projectiles.length).toBeGreaterThan(0);
      kernel.step(safeGapFollowingInput(kernel, pattern, 1680));
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1680,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
        projectileLifecycleDrained: true,
        handoffReady: true,
      });
      expect(kernel.events().filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(facts.candidates);
      expect(kernel.events().filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(facts.candidates);
      expect(kernel.events().some((event) =>
        event.id.startsWith("laser.")
        || event.id.startsWith("boss.phase.")
        || event.id === "boss.encounter.resolve"
        || event.id === "boss.rule.correctionFailed")).toBe(false);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.fullHash);
    }

    const evidenceKernel = new CanonicalCombatKernel({
      ...optionsFor("boss.one_sun_one_rule.phase1"),
      seed: ONE_SUN_ONE_RULE_REPORT_SEED,
      grazeRadiusPx: 60,
    });
    for (let tick120 = 1; tick120 <= 800; tick120 += 1) {
      evidenceKernel.step(safeGapFollowingInput(evidenceKernel, pattern, tick120));
    }
    expect(evidenceKernel.snapshot()).toMatchObject({
      patternComplete: false,
      player: {health: 3},
      evidence: {consumedPurposeCount: 0},
    });
    expect(evidenceKernel.snapshot().evidence.amount).toBeGreaterThanOrEqual(1);
    expect(evidenceKernel.events().some((event) => event.id === "projectile.graze.commit"))
      .toBe(true);
    expect(evidenceKernel.events().some((event) =>
      event.id.startsWith("laser.")
      || event.id.startsWith("boss.phase.")
      || event.id === "boss.encounter.resolve"
      || event.id === "boss.rule.correctionFailed")).toBe(false);
  });

  it("keeps motion and event identities relative to a nonzero run handoff tick", () => {
    const pattern = executablePattern("boss.one_sun_one_rule.phase1");
    const offsetTick120 = 509;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("boss.one_sun_one_rule.phase1"),
      seed: ONE_SUN_ONE_RULE_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("boss.one_sun_one_rule.phase1"),
      seed: ONE_SUN_ONE_RULE_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number) => {
      const input = safeGapFollowingInput(kernel, pattern, relativeTick120);
      kernel.step({
        ...input,
        tick120: kernel.snapshot().startTick120 + relativeTick120,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 800; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
    expect(offset.snapshot().poolUsage).toEqual(zero.snapshot().poolUsage);
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
  });

  it("stays trace-identical across render cadence, retained backlog, weather, and accessibility projections", {
    timeout: 20_000,
  }, () => {
    const targetTick120 = 1380;
    const durationMs = targetTick120 * 1000 / 120;
    const baseline = driveOneSunOneRuleWithDeltas(
      Array.from({length: 345}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveOneSunOneRuleWithDeltas(
        Array.from({length: 690}, () => 1000 / 60),
        targetTick120,
        {weatherEvent: "sleet", reducedMotion: true, flashOff: true},
      ),
      driveOneSunOneRuleWithDeltas(
        Array.from({length: 1656}, () => 1000 / 144),
        targetTick120,
        {weatherEvent: "ash", reducedMotion: false, flashOff: true},
      ),
      driveOneSunOneRuleWithDeltas(
        [durationMs],
        targetTick120,
        {weatherEvent: "clear", reducedMotion: true, flashOff: false},
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated Clock Decree room-pattern combat capability", () => {
  it("pins the exact room contract, adapter provenance, and immutable QA evidence", () => {
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.clock_decree"),
      seed: CLOCK_DECREE_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateClockDecreePatternContract(contract)).not.toThrow();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.emitters)).toBe(true);
    expect(contract).toMatchObject({
      id: "room.polarized.clock_decree",
      category: "ROOM",
      room: "POLARIZED",
      name: {zh: "时钟法令", en: "Clock decree"},
      intent: "四拍只允许开或关，安全窗口来自法令之间的沉默。",
      durationMs: 10000,
      clock: {
        authority: "GAMEPLAY",
        tickHz: 120,
        eventDispatch: "crossed-time-exactly-once",
        pausePolicy: "freeze",
        visualClockSeparated: true,
      },
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 576, event: "collision.arm"},
        {atMs: 576, event: "emit.begin"},
        {atMs: 5000, event: "pattern.midpoint"},
        {atMs: 9300, event: "emit.end"},
        {atMs: 9580, event: "residue.commit"},
        {atMs: 10000, event: "pattern.complete"},
      ],
      emitters: [{
        id: "binary-clock",
        kind: "projectile",
        anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
        geometry: {
          type: "shutter",
          variant: "four-beat-decree",
          count: 12,
          baseAngleDeg: 90,
          spreadDeg: 0,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 576, intervalMs: 500, bursts: 18, intraBurstMs: 0},
        projectile: {
          archetype: "bullet.micro.notch_e",
          collisionRadiusPx: 2,
          armDelayMs: 40,
        },
        speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 172}]},
        motionStack: [
          {
            operator: "op.dual_clock_gate",
            params: {
              periodAMs: 1000,
              periodBMs: 2000,
              dutyA: 0.5,
              dutyB: 0.5,
              phaseOffsetMs: 0,
            },
          },
          {operator: "op.linear", params: {}},
        ],
      }],
      safeGap: {
        type: "quantized_step",
        minimumWidthPx: 32,
        focusMinimumWidthPx: 24,
        path: {
          centerX: 180,
          amplitudePx: 54,
          periodMs: 4000,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        enforcement: "phase_gate",
        readability: {leadMs: 520, neverColorOnly: true},
      },
      warning: {
        durationMs: 576,
        shape: "four_beat_shutter",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      cancel: {
        triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
        mode: "digital_cancel_to_material_residue",
        collisionOffBeforeVisual: true,
        eventIdempotent: true,
      },
      residue: {
        type: "binary_chip",
        lifetimeMs: 2435,
        density: 0.43,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      seed: {
        algorithm: "mulberry32-v1",
        base: 1517220356,
        composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
        randomCalls: "emitter-order then burst-order then projectile-order",
      },
      accessibility: {
        reducedMotionGameplayParity: true,
        flashOffGameplayParity: true,
        telegraphNeverColorOnly: true,
      },
    });
    expect("laserGeometry" in contract).toBe(false);
    expect("resolutionHook" in contract).toBe(false);
    expect(kernel.snapshot().adapterGaps.clockDecreePhaseGate).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      clockIdentity: "pattern-relative-integer-tick120",
      effectiveGate: "dual-clock-xor-plus-continuous-quantized-triangle-collision-mask",
      quantizedPathSweep: "exact-cusp-segmented-linear",
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off",
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick",
      phaseGapBehavior: "same-generation-motion-retained-collision-off",
      collisionLease: "reversible-entity-owned-canonical-events",
      easyLateBurst: "cadence-owned-after-emit-end-then-pattern-end-cancelled",
      completeTickTie: "pattern-end-cancels-live-identities-before-gate-update",
    });

    const structure = patternStructureReportJson.patterns.find((entry) =>
      entry.patternId === "room.polarized.clock_decree");
    expect(structure).toEqual({
      patternId: "room.polarized.clock_decree",
      sha256: "6ee303ef957c6f47f9d5d36e88ca3b7673950335c9f0715c9a5a18e8fcb8b343",
      normalized: {
        emitterCount: 1,
        emitters: [{
          geometry: "shutter",
          countBand: 4,
          spreadBand: 0,
          cadenceBand: 3,
          burstBand: 6,
          speedKeyCount: 1,
          speedDirection: "flat",
          operators: ["op.dual_clock_gate", "op.linear"],
          parameterShapes: [["dutyA", "dutyB", "periodAMs", "periodBMs", "phaseOffsetMs"], []],
        }],
        gap: ["quantized_step", "phase_gate", 8],
        warning: "four_beat_shutter",
        timelineRatios: [0, 0.06, 0.06, 0.5, 0.93, 0.96, 1],
        hasLaser: false,
      },
    });
    const safeGap = safeGapReportJson.patterns.find((entry) =>
      entry.patternId === "room.polarized.clock_decree");
    expect(safeGap).toMatchObject({
      gapType: "quantized_step",
      widthPx: 32,
      enforcement: "phase_gate",
      normal: {
        pass: true,
        minimumClearancePx: 17.476,
        sampleCount: 101,
        pathHash: "e13842be6833dd18b4316868539e1334dd8579b9d091f46c438a452bee4576b4",
      },
      focus: {
        pass: true,
        minimumClearancePx: 18.476,
        sampleCount: 101,
        pathHash: "e13842be6833dd18b4316868539e1334dd8579b9d091f46c438a452bee4576b4",
      },
      pass: true,
    });

    const expectedOracle = {
      EASY: [17, 153, 22, "ddbfbf02011fc16e53117e66702bdd8b544f8124bb67e93e8bb1aad4300c0411"],
      NORMAL: [18, 216, 33, "895b02be0bf75752221ae54ec4ac2d1ef4bf8637f744b32d760e35bbec06f450"],
      HARD: [18, 252, 55, "6a4a588f6f2f7ef6efe55c24b26d9400b318691de1cc6be4fc44fbb7d0358ed0"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: CLOCK_DECREE_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: CLOCK_DECREE_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expectedOracle[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("fails closed on hostile drift while keeping the room slice outside live admission", () => {
    const source = structuredClone(executablePattern("room.polarized.clock_decree")) as unknown as {
      durationMs: number;
      safeGap: {type: string; enforcement: string};
      emitters: Array<{
        geometry: {type: string; count: number};
        motionStack: Array<{operator: string; params: Record<string, unknown>}>;
      }>;
      metadata?: string;
    };
    expect(() => validateClockDecreePatternContract(source)).not.toThrow();

    const extra = structuredClone(source);
    extra.metadata = "composer-write-back";
    expect(() => validateClockDecreePatternContract(extra)).toThrow(/contract drifted/);
    const durationDrift = structuredClone(source);
    durationDrift.durationMs += 1;
    expect(() => validateClockDecreePatternContract(durationDrift)).toThrow(/contract drifted/);
    const gapDrift = structuredClone(source);
    gapDrift.safeGap.type = "dual_clock_intersection";
    expect(() => validateClockDecreePatternContract(gapDrift)).toThrow(/contract drifted/);
    const phaseDrift = structuredClone(source);
    phaseDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateClockDecreePatternContract(phaseDrift)).toThrow(/contract drifted/);
    const geometryDrift = structuredClone(source);
    geometryDrift.emitters[0]!.geometry.type = "grid";
    expect(() => validateClockDecreePatternContract(geometryDrift)).toThrow(/contract drifted/);
    const orderDrift = structuredClone(source);
    orderDrift.emitters[0]!.motionStack.reverse();
    expect(() => validateClockDecreePatternContract(orderDrift)).toThrow(/contract drifted/);
    const hiddenDuration = structuredClone(source);
    Object.defineProperty(hiddenDuration, "durationMs", {
      value: source.durationMs,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    expect(() => validateClockDecreePatternContract(hiddenDuration))
      .toThrow(/enumerable own data property/);

    let safeGapReads = 0;
    const accessorPattern = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        safeGapReads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateClockDecreePatternContract(accessorPattern))
      .toThrow(/own data property/);
    expect(safeGapReads).toBe(0);
    let countReads = 0;
    const nestedAccessor = structuredClone(source);
    Object.defineProperty(nestedAccessor.emitters[0]!.geometry, "count", {
      enumerable: true,
      get() {
        countReads += 1;
        return 12;
      },
    });
    expect(() => validateClockDecreePatternContract(nestedAccessor))
      .toThrow(/own data property/);
    expect(countReads).toBe(0);
    const revoked = Proxy.revocable(structuredClone(source), {});
    revoked.revoke();
    expect(() => validateClockDecreePatternContract(revoked.proxy)).toThrow();

    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS)
      .not.toContain("room.polarized.clock_decree");
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("room.polarized.clock_decree"),
      seed: CLOCK_DECREE_REPORT_SEED,
    })).not.toThrow();
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("room.polarized.clock_decree"),
      patternId: "boss.two_claims.phase1" as CanonicalCombatPatternId,
    })).toThrow(/does not yet support pattern/);
  });

  it("preserves the exact E\/N\/H cadence, triangle path, RNG identity, and late EASY burst", () => {
    const pattern = executablePattern("room.polarized.clock_decree");
    const expected = {
      EASY: {
        count: 9,
        candidates: 153,
        speed: 151.36,
        gap: 40,
        spawn: [70, 139, 209, 278, 348, 418, 487, 557, 626, 696, 766, 835, 905, 974, 1044, 1114, 1183],
        arm: [74, 144, 214, 283, 353, 422, 492, 562, 631, 701, 770, 840, 910, 979, 1049, 1118, 1188],
      },
      NORMAL: {
        count: 12,
        candidates: 216,
        speed: 172,
        gap: 32,
        spawn: [70, 130, 190, 250, 310, 370, 430, 490, 550, 610, 670, 730, 790, 850, 910, 970, 1030, 1090],
        arm: [74, 134, 194, 254, 314, 374, 434, 494, 554, 614, 674, 734, 794, 854, 914, 974, 1034, 1094],
      },
      HARD: {
        count: 14,
        candidates: 252,
        speed: 192.64,
        gap: 28,
        spawn: [70, 122, 175, 228, 281, 334, 386, 439, 492, 545, 598, 650, 703, 756, 809, 862, 914, 967],
        arm: [74, 127, 180, 233, 286, 338, 391, 444, 497, 550, 602, 655, 708, 761, 814, 866, 919, 972],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(expected[difficulty].spawn);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs + 40)))
        .toEqual(expected[difficulty].arm);
      expect(schedule.every((entry) => entry.emitter.geometry.type === "shutter")).toBe(true);
      expect(schedule.reduce((total, entry) => total + roundPatternCount(
        entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      ), 0)).toBe(expected[difficulty].candidates);
      expect(roundPatternCount(12 * pattern.difficulty[difficulty].countMultiplier))
        .toBe(expected[difficulty].count);
      expect(172 * pattern.difficulty[difficulty].speedMultiplier)
        .toBeCloseTo(expected[difficulty].speed, 12);
      expect(safeGapWidth(pattern, difficulty)).toBe(expected[difficulty].gap);
    }
    expect([0, 576, 576, 5000, 9300, 9580, 10000].map(crossedTickCount))
      .toEqual([0, 70, 70, 600, 1116, 1150, 1200]);
    expect(crossedTickCount(2435)).toBe(293);
    expect([0, 120, 240, 360, 480].map((tick120) =>
      safeGapCenter(pattern, tick120 * 1000 / 120)))
      .toEqual([180, 234, 180, 126, 180]);
    expect(safeGapCenter(pattern, 121 * 1000 / 120)
      - safeGapCenter(pattern, 120 * 1000 / 120)).toBeCloseTo(-54 / 120, 12);

    const easySchedule = createPatternSchedule(pattern, "EASY");
    expect(easySchedule).toHaveLength(17);
    expect(easySchedule[16]).toMatchObject({burstIndex: 16, atMs: 9856});
    expect(easySchedule[16]!.atMs).toBeGreaterThan(9300);
    expect(easySchedule[16]!.atMs).toBeGreaterThan(9580);
    expect(576 + 17 * 500 * pattern.difficulty.EASY.cadenceMultiplier)
      .toBeGreaterThan(pattern.durationMs);
  });

  it("applies literal XOR clock boundaries and masks the continuous gap without freezing motion", () => {
    const pattern = executablePattern("room.polarized.clock_decree");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.clock_decree"),
      seed: CLOCK_DECREE_REPORT_SEED,
    });
    const sampleTicks = new Set([70, 74, 75, 179, 180, 299, 300, 301, 576, 577, 578, 659, 660, 779, 780]);
    const samples = new Map<number, ReturnType<CanonicalCombatKernel["snapshot"]>>();
    for (let tick120 = 1; tick120 <= 780; tick120 += 1) {
      const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      if (sampleTicks.has(tick120)) samples.set(tick120, snapshot);
    }
    const projectileAt = (tick120: number, sourceIndex: number) => {
      const projectile = samples.get(tick120)?.projectiles.find((entry) =>
        entry.sourceId === "binary-clock"
        && entry.burstIndex === 0
        && entry.sourceIndex === sourceIndex);
      expect(projectile, `Clock source index ${sourceIndex} at ${tick120}`).toBeDefined();
      return projectile as NonNullable<typeof projectile>;
    };

    expect(projectileAt(70, 0)).toMatchObject({
      state: "arm",
      collisionEnabled: false,
      position: {y: 102.4},
      spawnedAtTick: 70,
      armAtTick: 74,
      movedAtTick120: null,
    });
    expect(projectileAt(74, 0)).toMatchObject({
      state: "flight",
      collisionEnabled: true,
      position: {y: 102.4},
      movedAtTick120: null,
    });
    expect(projectileAt(75, 0).position.y - projectileAt(74, 0).position.y)
      .toBeCloseTo(172 / 120, 12);
    expect(projectileAt(179, 0)).toMatchObject({
      collisionEnabled: true,
      speedPxPerSecond: 172,
    });
    expect(projectileAt(179, 0).position.y).toBeCloseTo(252.9, 12);
    expect(projectileAt(180, 0)).toMatchObject({
      collisionEnabled: false,
      speedPxPerSecond: 0,
    });
    expect(projectileAt(180, 0).position).toEqual(projectileAt(179, 0).position);
    expect(projectileAt(299, 0).position).toEqual(projectileAt(180, 0).position);
    expect(projectileAt(300, 0)).toMatchObject({
      collisionEnabled: true,
      speedPxPerSecond: 0,
    });
    expect(projectileAt(300, 0).position).toEqual(projectileAt(299, 0).position);
    expect(projectileAt(301, 0).position.y - projectileAt(300, 0).position.y)
      .toBeCloseTo(172 / 120, 12);
    expect(projectileAt(301, 0).speedPxPerSecond).toBe(172);

    const first = projectileAt(179, 0);
    expect(kernel.events()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 180,
        entityStableId: first.instanceId,
        payload: expect.objectContaining({reason: "dual_clock_gate"}),
      }),
      expect.objectContaining({
        id: "projectile.collision.on",
        tick120: 300,
        entityStableId: first.instanceId,
      }),
    ]));

    const phaseBefore = projectileAt(576, 7);
    const phaseMasked = projectileAt(577, 7);
    expect(phaseBefore).toMatchObject({collisionEnabled: true, speedPxPerSecond: 172});
    expect(phaseBefore.position.y).toBeCloseTo(475.06666666666763, 10);
    expect(phaseMasked).toMatchObject({collisionEnabled: false, speedPxPerSecond: 172});
    expect(phaseMasked.position.y - phaseBefore.position.y).toBeCloseTo(172 / 120, 12);
    expect(projectileAt(578, 7).position.y - phaseMasked.position.y)
      .toBeCloseTo(172 / 120, 12);
    expect(projectileAt(660, 7).speedPxPerSecond).toBe(0);
    expect(projectileAt(779, 7).position).toEqual(projectileAt(660, 7).position);
    expect(projectileAt(780, 7)).toMatchObject({
      instanceId: phaseBefore.instanceId,
      generation: phaseBefore.generation,
      collisionEnabled: true,
      speedPxPerSecond: 0,
    });
    expect(kernel.events()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 577,
        entityStableId: phaseBefore.instanceId,
        payload: expect.objectContaining({reason: "phase_gate"}),
      }),
      expect.objectContaining({
        id: "projectile.collision.on",
        tick120: 780,
        entityStableId: phaseBefore.instanceId,
      }),
    ]));
    expect(kernel.events().some((event) =>
      event.entityStableId === phaseBefore.instanceId
      && event.payload.reason === "source_withdrawn")).toBe(false);
    expect(new Set(kernel.events().map((event) => event.occurrenceKey)).size)
      .toBe(kernel.events().length);
  });

  it("retains every E\/N\/H identity, protects the corridor, and drains exactly", {
    timeout: 30_000,
  }, () => {
    const pattern = executablePattern("room.polarized.clock_decree");
    const allowedEventIds = new Set([
      "evidence.gain.commit",
      "projectile.arm.begin",
      "projectile.armed",
      "projectile.cancel.commit",
      "projectile.collision.off",
      "projectile.collision.on",
      "projectile.flight.begin",
      "projectile.graze.commit",
      "projectile.lifecycle.complete",
      "projectile.residue.begin",
      "projectile.residue.remove",
      "projectile.spawn.commit",
    ]);
    const expected = {
      EASY: {
        candidates: 153,
        on: 408,
        off: 552,
        dualOff: 379,
        phaseOff: 20,
        outOfBounds: 9,
        patternEnd: 144,
        activeResidue: 153,
        removedAtEnd: 0,
        allocated: 153,
        peakLive: 133,
        peakResidue: 153,
        evidence: 0,
        firstEvidenceTick: null,
        drainingAt1492: 144,
        endHash: "364c95cebf91b115de2238b7bbaefa647b88a07892dc8242dcf25cefe70fe06e",
        fullHash: "45074fc107311af97af8c7f7c478ff0a985af0cf40121cf5f9392a28a9f5999c",
      },
      NORMAL: {
        candidates: 216,
        on: 616,
        off: 784,
        dualOff: 537,
        phaseOff: 31,
        outOfBounds: 48,
        patternEnd: 168,
        activeResidue: 216,
        removedAtEnd: 0,
        allocated: 216,
        peakLive: 190,
        peakResidue: 216,
        evidence: 0,
        firstEvidenceTick: null,
        drainingAt1492: 168,
        endHash: "bde5e39ebc67f11c95a675792af154e219ba44b7efc35e62865d4e7cc74249ba",
        fullHash: "4732a1497d743ab9cf896c4a6774762fcad84fe6bcfd99198c527ed3ac6f2bd5",
      },
      HARD: {
        candidates: 252,
        on: 787,
        off: 955,
        dualOff: 654,
        phaseOff: 49,
        outOfBounds: 84,
        patternEnd: 168,
        activeResidue: 238,
        removedAtEnd: 14,
        allocated: 252,
        peakLive: 232,
        peakResidue: 238,
        evidence: 8,
        firstEvidenceTick: 659,
        drainingAt1492: 168,
        endHash: "14962808bf7d5003ade192815addd6e1bfce394c6d05a33ac6562371bc7e5911",
        fullHash: "ea15a504c83f6755324beb1930db3e59c3d0875b77c84b5d55f666d9bd34ad9f",
      },
    } as const;

    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.polarized.clock_decree"),
        seed: CLOCK_DECREE_REPORT_SEED,
        difficulty,
      });
      let peakLive = 0;
      let peakResidue = 0;
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      let firstEvidenceTick: number | null = null;
      for (let tick120 = 1; tick120 <= 1200; tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        peakLive = Math.max(peakLive, snapshot.poolUsage.liveColliders);
        peakResidue = Math.max(peakResidue, snapshot.poolUsage.residueVisuals);
        if (firstEvidenceTick === null && snapshot.evidence.amount > 0) {
          firstEvidenceTick = tick120;
          expect(snapshot).toMatchObject({patternComplete: false, handoffReady: false});
        }
        const corridorCenter = safeGapCenter(pattern, tick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state !== "flight"
            || !projectile.collisionEnabled
            || projectile.position.y < 476
            || projectile.position.y > 622
          ) continue;
          minimumCollisionMargin = Math.min(
            minimumCollisionMargin,
            Math.abs(projectile.position.x - corridorCenter) - (
              safeGapWidth(pattern, difficulty) / 2
              + projectile.collisionRadiusPx
              + 2
            ),
          );
        }
      }
      const snapshot = kernel.snapshot();
      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      expect([...new Set(events.map((event) => event.id))]
        .every((id) => allowedEventIds.has(id))).toBe(true);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect(firstEvidenceTick).toBe(facts.firstEvidenceTick);
      expect({
        rng: snapshot.rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        armBegin: count("projectile.arm.begin"),
        armed: count("projectile.armed"),
        flight: count("projectile.flight.begin"),
        on: count("projectile.collision.on"),
        off: count("projectile.collision.off"),
        dualOff: count("projectile.collision.off", "dual_clock_gate"),
        phaseOff: count("projectile.collision.off", "phase_gate"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        cancel: count("projectile.cancel.commit"),
        residue: count("projectile.residue.begin"),
        removed: count("projectile.residue.remove"),
        graze: count("projectile.graze.commit"),
        evidence: snapshot.evidence.amount,
        activeResidue: snapshot.projectiles.length,
        allocated: snapshot.poolUsage.allocatedSlots.micro,
        peakLive,
        peakResidue,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        rng: facts.candidates,
        spawn: facts.candidates,
        armBegin: facts.candidates,
        armed: facts.candidates,
        flight: facts.candidates,
        on: facts.on,
        off: facts.off,
        dualOff: facts.dualOff,
        phaseOff: facts.phaseOff,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        cancel: facts.candidates,
        residue: facts.candidates,
        removed: facts.removedAtEnd,
        graze: facts.evidence,
        evidence: facts.evidence,
        activeResidue: facts.activeResidue,
        allocated: facts.allocated,
        peakLive: facts.peakLive,
        peakResidue: facts.peakResidue,
        hash: facts.endHash,
      });
      expect(snapshot).toMatchObject({
        tick120: 1200,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
        player: {health: 3},
        poolUsage: {liveColliders: 0, residueVisuals: facts.activeResidue},
      });
      expect(snapshot.projectiles.every((projectile) =>
        projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
      expect(kernel.projectilePoolAudit()).toEqual([]);
      expect(events.some((event) =>
        event.id === "projectile.impact.commit"
        || event.id === "player.damage.commit"
        || event.id.startsWith("laser.")
        || event.id.startsWith("boss.")
        || event.id.startsWith("room.")
        || event.payload.reason === "source_withdrawn")).toBe(false);
      expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);

      if (difficulty === "EASY") {
        const late = snapshot.projectiles.filter((projectile) =>
          projectile.sourceId === "binary-clock" && projectile.burstIndex === 16);
        expect(late).toHaveLength(9);
        expect(late).toEqual(expect.arrayContaining(Array.from({length: 9}, () =>
          expect.objectContaining({
            state: "residue",
            collisionEnabled: false,
            spawnedAtTick: 1183,
            armAtTick: 1188,
            movedAtTick120: 1199,
            position: expect.objectContaining({y: 102.4}),
            speedPxPerSecond: 0,
            terminalCause: "cancel",
          }))));
        for (const projectile of late) {
          expect(events.some((event) =>
            event.entityStableId === projectile.instanceId
            && event.id === "projectile.collision.on")).toBe(false);
          expect(events.filter((event) =>
            event.tick120 === 1200 && event.entityStableId === projectile.instanceId)
            .map((event) => event.id)).toEqual([
              "projectile.collision.off",
              "projectile.cancel.commit",
              "projectile.residue.begin",
            ]);
        }
      }

      for (let tick120 = 1201; tick120 <= 1492; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1492,
        projectileLifecycleDrained: false,
        handoffReady: false,
      });
      expect(kernel.snapshot().projectiles).toHaveLength(facts.drainingAt1492);
      kernel.step(safeGapFollowingInput(kernel, pattern, 1493));
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1493,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
        projectileLifecycleDrained: true,
        handoffReady: true,
      });
      expect(kernel.events().filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(facts.candidates);
      expect(kernel.events().filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(facts.candidates);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.fullHash);
    }
  });

  it("keeps gate, motion, and event identities relative to a nonzero start tick", () => {
    const pattern = executablePattern("room.polarized.clock_decree");
    const offsetTick120 = 401;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.clock_decree"),
      seed: CLOCK_DECREE_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.clock_decree"),
      seed: CLOCK_DECREE_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number) => {
      const input = safeGapFollowingInput(kernel, pattern, relativeTick120);
      kernel.step({
        ...input,
        tick120: kernel.snapshot().startTick120 + relativeTick120,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 800; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
    expect(offset.snapshot().poolUsage).toEqual(zero.snapshot().poolUsage);
  });

  it("stays trace-identical across cadence, backlog, weather, and accessibility projections", {
    timeout: 20_000,
  }, () => {
    const targetTick120 = 1200;
    const baseline = driveClockDecreeWithDeltas(
      Array.from({length: 300}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveClockDecreeWithDeltas(
        Array.from({length: 600}, () => 1000 / 60),
        targetTick120,
        {weatherEvent: "sleet", reducedMotion: true, flashOff: true},
      ),
      driveClockDecreeWithDeltas(
        Array.from({length: 1440}, () => 1000 / 144),
        targetTick120,
        {weatherEvent: "ash", reducedMotion: false, flashOff: true},
      ),
      driveClockDecreeWithDeltas(
        [10_000],
        targetTick120,
        {weatherEvent: "clear", reducedMotion: true, flashOff: false},
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated No-dusk Grid room-pattern combat capability", () => {
  it("pins the exact room contract, adapter provenance, and immutable QA evidence", () => {
    const pattern = executablePattern("room.polarized.no_dusk_grid");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.no_dusk_grid"),
      seed: NO_DUSK_GRID_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateNoDuskGridPatternContract(contract)).not.toThrow();
    expect(contract).toEqual(pattern);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.emitters)).toBe(true);
    expect(contract).toMatchObject({
      id: "room.polarized.no_dusk_grid",
      category: "ROOM",
      room: "POLARIZED",
      name: {zh: "没有黄昏的网格", en: "No-dusk grid"},
      intent: "亮暗不经过过渡；网格只在离散时刻重写。",
      durationMs: 12200,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 551, event: "collision.arm"},
        {atMs: 551, event: "emit.begin"},
        {atMs: 6100, event: "pattern.midpoint"},
        {atMs: 11500, event: "emit.end"},
        {atMs: 11780, event: "residue.commit"},
        {atMs: 12200, event: "pattern.complete"},
      ],
      emitters: [
        {
          id: "vertical-law",
          anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
          geometry: {
            type: "grid",
            variant: "vertical-binary",
            count: 9,
            baseAngleDeg: 90,
            spreadDeg: 0,
            ordering: "clockwise-then-source-index",
          },
          cadence: {startMs: 551, intervalMs: 750, bursts: 14, intraBurstMs: 0},
          projectile: {
            archetype: "bullet.micro.notch_e",
            collisionRadiusPx: 2,
            armDelayMs: 40,
          },
          speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 150}]},
          motionStack: [
            {
              operator: "op.dual_clock_gate",
              params: {
                periodAMs: 1500,
                periodBMs: 3000,
                dutyA: 0.48,
                dutyB: 0.48,
                phaseOffsetMs: 0,
              },
            },
            {operator: "op.linear", params: {}},
          ],
        },
        {
          id: "diagonal-law",
          anchor: {space: "viewport-normalized", x: 0.5, y: 0.18},
          geometry: {
            type: "cross",
            variant: "diagonal-binary",
            count: 6,
            baseAngleDeg: 68,
            spreadDeg: 44,
            ordering: "clockwise-then-source-index",
          },
          cadence: {startMs: 926, intervalMs: 1500, bursts: 7, intraBurstMs: 0},
          projectile: {
            archetype: "bullet.micro.notch_e",
            collisionRadiusPx: 2,
            armDelayMs: 40,
          },
          speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 188}]},
          motionStack: [
            {
              operator: "op.dual_clock_gate",
              params: {
                periodAMs: 3000,
                periodBMs: 1500,
                dutyA: 0.48,
                dutyB: 0.48,
                phaseOffsetMs: 750,
              },
            },
            {operator: "op.linear", params: {}},
          ],
        },
      ],
      safeGap: {
        type: "binary_cross",
        minimumWidthPx: 40,
        focusMinimumWidthPx: 32,
        path: {
          centerX: 180,
          amplitudePx: 20,
          periodMs: 6000,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        enforcement: "phase_gate",
        compileRule:
          "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
        readability: {leadMs: 520, neverColorOnly: true},
      },
      warning: {
        durationMs: 551,
        shape: "binary_grid_union",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      residue: {
        type: "binary_chip",
        lifetimeMs: 2640,
        density: 0.43,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      seed: {
        algorithm: "mulberry32-v1",
        base: 2541745312,
        composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
        randomCalls: "emitter-order then burst-order then projectile-order",
      },
      resolutionHook: "no_dusk_clock_ticks",
    });
    expect("laserGeometry" in contract).toBe(false);
    expect(kernel.snapshot().adapterGaps.noDuskGridPhaseGate).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      clockIdentity: "pattern-relative-integer-tick120",
      effectiveGate:
        "emitter-owned-dual-clock-xor-plus-continuous-binary-cross-collision-mask",
      binaryCrossSweep: "exact-cusp-segmented-linear",
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off",
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick",
      phaseGapBehavior: "same-generation-motion-retained-collision-off",
      collisionLease: "reversible-entity-owned-canonical-events",
      easyLateBurst: "cadence-owned-after-emit-end-and-residue-marker",
      resolutionHook: "validated-inert-no-automatic-completion",
      completeTickTie: "pattern-end-cancels-live-identities-before-gate-update",
    });

    expect(patternStructureReportJson.patterns.find((entry) =>
      entry.patternId === pattern.id)).toEqual({
      patternId: pattern.id,
      sha256: "f503184555f52aecbd6511bc2aa7041b8a1c43e3ac9a935d63ec469f0da85c62",
      normalized: {
        emitterCount: 2,
        emitters: [
          {
            geometry: "grid",
            countBand: 3,
            spreadBand: 0,
            cadenceBand: 4,
            burstBand: 4,
            speedKeyCount: 1,
            speedDirection: "flat",
            operators: ["op.dual_clock_gate", "op.linear"],
            parameterShapes: [
              ["dutyA", "dutyB", "periodAMs", "periodBMs", "phaseOffsetMs"],
              [],
            ],
          },
          {
            geometry: "cross",
            countBand: 2,
            spreadBand: 1,
            cadenceBand: 9,
            burstBand: 2,
            speedKeyCount: 1,
            speedDirection: "flat",
            operators: ["op.dual_clock_gate", "op.linear"],
            parameterShapes: [
              ["dutyA", "dutyB", "periodAMs", "periodBMs", "phaseOffsetMs"],
              [],
            ],
          },
        ],
        gap: ["binary_cross", "phase_gate", 10],
        warning: "binary_grid_union",
        timelineRatios: [0, 0.05, 0.05, 0.5, 0.94, 0.97, 1],
        hasLaser: false,
      },
    });
    expect(safeGapReportJson.patterns.find((entry) => entry.patternId === pattern.id))
      .toMatchObject({
        gapType: "binary_cross",
        widthPx: 40,
        enforcement: "phase_gate",
        normal: {
          pass: true,
          minimumClearancePx: 19.582,
          sampleCount: 123,
          pathHash: "8fd531dd33b67c670fb469abfdc7c7805b3b2d96dbf47f2d227ffb20a04222b5",
        },
        focus: {
          pass: true,
          minimumClearancePx: 20.582,
          sampleCount: 123,
          pathHash: "8fd531dd33b67c670fb469abfdc7c7805b3b2d96dbf47f2d227ffb20a04222b5",
        },
        pass: true,
      });

    const expectedOracle = {
      EASY: [21, 133, 13, "e587211cb50d6e42a0feab07f08d18520188495314743e53cc2f79c189315bcd"],
      NORMAL: [21, 168, 18, "b2c402fd550d19386c096ca39f3bf40e12f63fb64080e3d4660acbbdfc49b3f6"],
      HARD: [21, 203, 22, "9871c0383df928b0c2f8594380e9295a31f88e30f6bbce0b440084a3947eba57"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: NO_DUSK_GRID_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: NO_DUSK_GRID_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expectedOracle[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("fails closed on hostile drift and keeps room authority separate from the No Dusk Boss", () => {
    const source = structuredClone(executablePattern("room.polarized.no_dusk_grid")) as unknown as {
      durationMs: number;
      resolutionHook: string;
      safeGap: {type: string; enforcement: string};
      emitters: Array<{
        id: string;
        geometry: {type: string; count: number};
        motionStack: Array<{operator: string; params: Record<string, unknown>}>;
      }>;
      metadata?: string;
    };
    expect(() => validateNoDuskGridPatternContract(source)).not.toThrow();

    const extra = structuredClone(source);
    extra.metadata = "composer-write-back";
    expect(() => validateNoDuskGridPatternContract(extra)).toThrow(/contract drifted/);
    const durationDrift = structuredClone(source);
    durationDrift.durationMs += 1;
    expect(() => validateNoDuskGridPatternContract(durationDrift)).toThrow(/contract drifted/);
    const hookDrift = structuredClone(source);
    hookDrift.resolutionHook = "boss.noDusk.protocolRetracted";
    expect(() => validateNoDuskGridPatternContract(hookDrift)).toThrow(/contract drifted/);
    const gapDrift = structuredClone(source);
    gapDrift.safeGap.type = "dual_clock_intersection";
    expect(() => validateNoDuskGridPatternContract(gapDrift)).toThrow(/contract drifted/);
    const phaseDrift = structuredClone(source);
    phaseDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateNoDuskGridPatternContract(phaseDrift)).toThrow(/contract drifted/);
    const geometryDrift = structuredClone(source);
    geometryDrift.emitters[1]!.geometry.type = "paired_fan";
    expect(() => validateNoDuskGridPatternContract(geometryDrift)).toThrow(/contract drifted/);
    const emitterOrderDrift = structuredClone(source);
    emitterOrderDrift.emitters.reverse();
    expect(() => validateNoDuskGridPatternContract(emitterOrderDrift)).toThrow(/contract drifted/);
    const operatorOrderDrift = structuredClone(source);
    operatorOrderDrift.emitters[0]!.motionStack.reverse();
    expect(() => validateNoDuskGridPatternContract(operatorOrderDrift)).toThrow(/contract drifted/);
    const hiddenHook = structuredClone(source);
    Object.defineProperty(hiddenHook, "resolutionHook", {
      value: source.resolutionHook,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    expect(() => validateNoDuskGridPatternContract(hiddenHook))
      .toThrow(/enumerable own data property/);

    let safeGapReads = 0;
    const accessorPattern = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        safeGapReads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateNoDuskGridPatternContract(accessorPattern))
      .toThrow(/own data property/);
    expect(safeGapReads).toBe(0);
    let periodReads = 0;
    const nestedAccessor = structuredClone(source);
    Object.defineProperty(nestedAccessor.emitters[1]!.motionStack[0]!.params, "periodAMs", {
      enumerable: true,
      get() {
        periodReads += 1;
        return 3000;
      },
    });
    expect(() => validateNoDuskGridPatternContract(nestedAccessor))
      .toThrow(/own data property/);
    expect(periodReads).toBe(0);
    const revoked = Proxy.revocable(structuredClone(source), {});
    revoked.revoke();
    expect(() => validateNoDuskGridPatternContract(revoked.proxy)).toThrow();

    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS)
      .not.toContain("room.polarized.no_dusk_grid");
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("room.polarized.no_dusk_grid"),
      seed: NO_DUSK_GRID_REPORT_SEED,
    })).not.toThrow();
    for (const bossPatternId of [
      "boss.no_dusk.phase1",
      "boss.no_dusk.phase2",
      "boss.no_dusk.phase3",
    ]) {
      expect(() => new CanonicalCombatKernel({
        ...optionsFor("room.polarized.no_dusk_grid"),
        patternId: bossPatternId as CanonicalCombatPatternId,
      })).toThrow(/does not yet support pattern/);
    }
  });

  it("preserves exact E\/N\/H cadence, geometry, triangle path, RNG identity, and late EASY burst", () => {
    const pattern = executablePattern("room.polarized.no_dusk_grid");
    const expected = {
      EASY: {
        verticalCount: 7,
        diagonalCount: 5,
        candidates: 133,
        verticalSpeed: 132,
        diagonalSpeed: 165.44,
        gap: 48,
        verticalSpawn: [67, 171, 275, 380, 484, 589, 693, 797, 902, 1006, 1111, 1215, 1319, 1424],
        verticalArm: [71, 176, 280, 385, 489, 593, 698, 802, 907, 1011, 1115, 1220, 1324, 1429],
        diagonalSpawn: [112, 320, 529, 738, 947, 1156, 1364],
        diagonalArm: [116, 325, 534, 743, 952, 1160, 1369],
      },
      NORMAL: {
        verticalCount: 9,
        diagonalCount: 6,
        candidates: 168,
        verticalSpeed: 150,
        diagonalSpeed: 188,
        gap: 40,
        verticalSpawn: [67, 157, 247, 337, 427, 517, 607, 697, 787, 877, 967, 1057, 1147, 1237],
        verticalArm: [71, 161, 251, 341, 431, 521, 611, 701, 791, 881, 971, 1061, 1151, 1241],
        diagonalSpawn: [112, 292, 472, 652, 832, 1012, 1192],
        diagonalArm: [116, 296, 476, 656, 836, 1016, 1196],
      },
      HARD: {
        verticalCount: 11,
        diagonalCount: 7,
        candidates: 203,
        verticalSpeed: 168,
        diagonalSpeed: 210.56,
        gap: 36,
        verticalSpawn: [67, 146, 225, 304, 383, 463, 542, 621, 700, 779, 859, 938, 1017, 1096],
        verticalArm: [71, 151, 230, 309, 388, 467, 547, 626, 705, 784, 863, 943, 1022, 1101],
        diagonalSpawn: [112, 270, 428, 587, 745, 904, 1062],
        diagonalArm: [116, 275, 433, 592, 750, 908, 1067],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const schedule = createPatternSchedule(pattern, difficulty);
      const vertical = schedule.filter((entry) => entry.emitter.id === "vertical-law");
      const diagonal = schedule.filter((entry) => entry.emitter.id === "diagonal-law");
      expect(vertical.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(facts.verticalSpawn);
      expect(vertical.map((entry) => crossedTickCount(entry.atMs + 40)))
        .toEqual(facts.verticalArm);
      expect(diagonal.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(facts.diagonalSpawn);
      expect(diagonal.map((entry) => crossedTickCount(entry.atMs + 40)))
        .toEqual(facts.diagonalArm);
      expect(schedule.map((entry) => entry.emitter.id[0])).toEqual([
        "v", "d", "v", "v", "d", "v", "v", "d", "v", "v", "d",
        "v", "v", "d", "v", "v", "d", "v", "v", "d", "v",
      ]);
      expect(roundPatternCount(9 * pattern.difficulty[difficulty].countMultiplier))
        .toBe(facts.verticalCount);
      expect(roundPatternCount(6 * pattern.difficulty[difficulty].countMultiplier))
        .toBe(facts.diagonalCount);
      expect(14 * facts.verticalCount + 7 * facts.diagonalCount).toBe(facts.candidates);
      expect(150 * pattern.difficulty[difficulty].speedMultiplier)
        .toBeCloseTo(facts.verticalSpeed, 12);
      expect(188 * pattern.difficulty[difficulty].speedMultiplier)
        .toBeCloseTo(facts.diagonalSpeed, 12);
      expect(safeGapWidth(pattern, difficulty)).toBe(facts.gap);
    }
    expect([0, 551, 551, 6100, 11500, 11780, 12200].map(crossedTickCount))
      .toEqual([0, 67, 67, 732, 1380, 1414, 1464]);
    expect(crossedTickCount(2640)).toBe(317);
    expect([0, 180, 360, 540, 720, 900, 1080, 1260, 1440].map((tick120) =>
      safeGapCenter(pattern, tick120 * 1000 / 120)))
      .toEqual([180, 200, 180, 160, 180, 200, 180, 160, 180]);
    expect(safeGapCenter(pattern, 181 * 1000 / 120)
      - safeGapCenter(pattern, 180 * 1000 / 120)).toBeCloseTo(-20 / 180, 12);

    const normalSchedule = createPatternSchedule(pattern, "NORMAL");
    const verticalEmitter = normalSchedule.find((entry) => entry.emitter.id === "vertical-law")!;
    const diagonalEmitter = normalSchedule.find((entry) => entry.emitter.id === "diagonal-law")!;
    expect(geometryCandidates(verticalEmitter.emitter, 0, 9).map((entry) => entry.x))
      .toEqual([
        34.22222222222222,
        70.66666666666666,
        107.11111111111111,
        143.55555555555554,
        180,
        216.44444444444446,
        252.88888888888889,
        289.33333333333337,
        325.77777777777777,
      ]);
    expect(geometryCandidates(verticalEmitter.emitter, 0, 9)
      .map((entry) => entry.headingDeg)).toEqual(Array.from({length: 9}, () => 90));
    expect(geometryCandidates(diagonalEmitter.emitter, 0, 6)
      .map((entry) => entry.headingDeg)).toEqual([68, 158, 248, 338, 76, 166]);

    const rngKernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.no_dusk_grid"),
      seed: NO_DUSK_GRID_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 112; tick120 += 1) {
      rngKernel.step(safeGapFollowingInput(rngKernel, pattern, tick120));
      if (tick120 === 67) expect(rngKernel.snapshot().rngCallsConsumed).toBe(9);
    }
    expect(rngKernel.snapshot().rngCallsConsumed).toBe(15);
    expect(rngKernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceId === "vertical-law" && projectile.sourceIndex === 0)?.headingDegrees)
      .toBe(90);
    expect(rngKernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceId === "diagonal-law" && projectile.sourceIndex === 0)?.headingDegrees)
      .toBeCloseTo(68.14582877258584, 12);

    const easySchedule = createPatternSchedule(pattern, "EASY");
    const late = easySchedule.find((entry) =>
      entry.emitter.id === "vertical-law" && entry.burstIndex === 13);
    expect(late?.atMs).toBeCloseTo(11861, 9);
    expect(crossedTickCount(late!.atMs)).toBe(1424);
    expect(late!.atMs).toBeGreaterThan(11500);
    expect(late!.atMs).toBeGreaterThan(11780);
    expect(late!.atMs).toBeLessThan(pattern.durationMs);
  });

  it("applies emitter-owned XOR boundaries and masks the binary cross without freezing motion", () => {
    const pattern = executablePattern("room.polarized.no_dusk_grid");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.no_dusk_grid"),
      seed: NO_DUSK_GRID_REPORT_SEED,
    });
    const sampleTicks = new Set([
      67, 71, 86, 87, 88, 112, 116, 172, 173, 174, 176, 177, 180, 181,
      582, 583, 584, 608, 609, 610,
    ]);
    const samples = new Map<number, ReturnType<CanonicalCombatKernel["snapshot"]>>();
    for (let tick120 = 1; tick120 <= 610; tick120 += 1) {
      const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      if (sampleTicks.has(tick120)) samples.set(tick120, snapshot);
    }
    const projectileAt = (
      tick120: number,
      sourceId: "vertical-law" | "diagonal-law",
      sourceIndex: number,
    ) => {
      const projectile = samples.get(tick120)?.projectiles.find((entry) =>
        entry.sourceId === sourceId && entry.burstIndex === 0 && entry.sourceIndex === sourceIndex);
      expect(projectile, `${sourceId}/${sourceIndex} at ${tick120}`).toBeDefined();
      return projectile as NonNullable<typeof projectile>;
    };

    expect(projectileAt(67, "vertical-law", 0)).toMatchObject({
      state: "arm",
      collisionEnabled: false,
      position: {y: 102.4},
      spawnedAtTick: 67,
      armAtTick: 71,
      movedAtTick120: null,
    });
    expect(projectileAt(71, "vertical-law", 0)).toMatchObject({
      state: "flight",
      collisionEnabled: false,
      speedPxPerSecond: 0,
      position: {y: 102.4},
    });
    expect(projectileAt(86, "vertical-law", 0).position.y).toBe(102.4);
    expect(projectileAt(87, "vertical-law", 0)).toMatchObject({
      collisionEnabled: true,
      speedPxPerSecond: 0,
      position: {y: 102.4},
    });
    expect(projectileAt(88, "vertical-law", 0).position.y
      - projectileAt(87, "vertical-law", 0).position.y).toBeCloseTo(150 / 120, 12);
    expect(projectileAt(172, "vertical-law", 0).position.y).toBeCloseTo(208.65, 12);
    expect(projectileAt(173, "vertical-law", 0)).toMatchObject({
      collisionEnabled: false,
      speedPxPerSecond: 0,
    });
    expect(projectileAt(173, "vertical-law", 0).position)
      .toEqual(projectileAt(172, "vertical-law", 0).position);
    expect(projectileAt(180, "vertical-law", 0)).toMatchObject({
      collisionEnabled: true,
      speedPxPerSecond: 0,
    });
    expect(projectileAt(180, "vertical-law", 0).position)
      .toEqual(projectileAt(173, "vertical-law", 0).position);
    expect(projectileAt(181, "vertical-law", 0).position.y
      - projectileAt(180, "vertical-law", 0).position.y).toBeCloseTo(150 / 120, 12);

    expect(projectileAt(112, "diagonal-law", 0)).toMatchObject({
      state: "arm",
      collisionEnabled: false,
      position: {x: 180, y: 115.19999999999999},
      spawnedAtTick: 112,
      armAtTick: 116,
    });
    expect(projectileAt(116, "diagonal-law", 0)).toMatchObject({
      state: "flight",
      collisionEnabled: false,
      speedPxPerSecond: 0,
    });
    expect(projectileAt(172, "diagonal-law", 0).position)
      .toEqual(projectileAt(116, "diagonal-law", 0).position);
    expect(projectileAt(173, "diagonal-law", 0)).toMatchObject({
      collisionEnabled: true,
      speedPxPerSecond: 0,
    });
    expect(projectileAt(174, "diagonal-law", 0)).toMatchObject({
      collisionEnabled: true,
      speedPxPerSecond: 188,
    });
    expect(projectileAt(177, "diagonal-law", 0)).toMatchObject({
      collisionEnabled: false,
      speedPxPerSecond: 0,
    });
    expect(projectileAt(177, "diagonal-law", 0).position)
      .toEqual(projectileAt(176, "diagonal-law", 0).position);

    const phaseBefore = projectileAt(582, "vertical-law", 3);
    const phaseMasked = projectileAt(583, "vertical-law", 3);
    expect(phaseBefore).toMatchObject({collisionEnabled: true, speedPxPerSecond: 150});
    expect(phaseBefore.position.y).toBeCloseTo(474.9, 12);
    expect(phaseMasked).toMatchObject({
      instanceId: phaseBefore.instanceId,
      generation: phaseBefore.generation,
      collisionEnabled: false,
      speedPxPerSecond: 150,
    });
    expect(phaseMasked.position.y - phaseBefore.position.y).toBeCloseTo(150 / 120, 12);
    expect(projectileAt(584, "vertical-law", 3).position.y - phaseMasked.position.y)
      .toBeCloseTo(150 / 120, 12);
    expect(projectileAt(608, "vertical-law", 3)).toMatchObject({
      collisionEnabled: false,
      speedPxPerSecond: 150,
    });
    expect(projectileAt(609, "vertical-law", 3)).toMatchObject({
      instanceId: phaseBefore.instanceId,
      generation: phaseBefore.generation,
      collisionEnabled: true,
      speedPxPerSecond: 150,
    });
    expect(projectileAt(609, "vertical-law", 3).position.y
      - projectileAt(608, "vertical-law", 3).position.y).toBeCloseTo(150 / 120, 12);
    expect(projectileAt(610, "vertical-law", 3).position.y
      - projectileAt(609, "vertical-law", 3).position.y).toBeCloseTo(150 / 120, 12);
    expect(kernel.events()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 173,
        entityStableId: projectileAt(172, "vertical-law", 0).instanceId,
        payload: expect.objectContaining({reason: "dual_clock_gate"}),
      }),
      expect.objectContaining({
        id: "projectile.collision.on",
        tick120: 173,
        entityStableId: projectileAt(173, "diagonal-law", 0).instanceId,
      }),
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 583,
        entityStableId: phaseBefore.instanceId,
        payload: expect.objectContaining({reason: "phase_gate"}),
      }),
      expect.objectContaining({
        id: "projectile.collision.on",
        tick120: 609,
        entityStableId: phaseBefore.instanceId,
      }),
    ]));
    expect(kernel.events().some((event) =>
      event.entityStableId === phaseBefore.instanceId
      && event.payload.reason === "source_withdrawn")).toBe(false);
    expect(new Set(kernel.events().map((event) => event.occurrenceKey)).size)
      .toBe(kernel.events().length);
  });

  it("retains every E\/N\/H identity, protects the corridor, keeps the hook inert, and drains exactly", {
    timeout: 40_000,
  }, () => {
    const pattern = executablePattern("room.polarized.no_dusk_grid");
    const allowedEventIds = new Set([
      "projectile.arm.begin",
      "projectile.armed",
      "projectile.cancel.commit",
      "projectile.collision.off",
      "projectile.collision.on",
      "projectile.flight.begin",
      "projectile.lifecycle.complete",
      "projectile.residue.begin",
      "projectile.residue.remove",
      "projectile.spawn.commit",
    ]);
    const expected = {
      EASY: {
        candidates: 133,
        on: 565,
        off: 656,
        dualOff: 512,
        phaseOff: 11,
        outOfBounds: 26,
        patternEnd: 107,
        removedAtEnd: 14,
        activeResidue: 119,
        allocated: 124,
        peakLive: 90,
        peakResidue: 119,
        drainingAt1780: 107,
        endHash: "3ddd331ca7e8a6da50fbd6e863743c58c21f1aab2c541be0f69b14e765b8987d",
        fullHash: "88ba6f54861d98819fae1ee0dba79dae9df1b27d4826b67aacd224b0a17bc1c6",
      },
      NORMAL: {
        candidates: 168,
        on: 810,
        off: 918,
        dualOff: 733,
        phaseOff: 17,
        outOfBounds: 49,
        patternEnd: 119,
        removedAtEnd: 20,
        activeResidue: 148,
        allocated: 159,
        peakLive: 129,
        peakResidue: 148,
        drainingAt1780: 119,
        endHash: "c9023f0f7ea2ab512901db451990f41fb9f07b0cb2aa845762d02af906243e61",
        fullHash: "aa941a85fd21c0c855d9bcb4a2cf1952ea088dc058d5b6e09ef8ec4b9c06a221",
      },
      HARD: {
        candidates: 203,
        on: 936,
        off: 1024,
        dualOff: 804,
        phaseOff: 17,
        outOfBounds: 109,
        patternEnd: 94,
        removedAtEnd: 42,
        activeResidue: 161,
        allocated: 189,
        peakLive: 154,
        peakResidue: 161,
        drainingAt1780: 94,
        endHash: "e465928f2680f83cb53009da3f1b3895bee873f7bad3db33c792ac3282bcdfa5",
        fullHash: "3d50e7891159a3ab2d5146270796273c48b56cad8929a950db1e383325dbaf61",
      },
    } as const;

    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.polarized.no_dusk_grid"),
        seed: NO_DUSK_GRID_REPORT_SEED,
        difficulty,
      });
      let peakLive = 0;
      let peakResidue = 0;
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      for (let tick120 = 1; tick120 <= 1464; tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        peakLive = Math.max(peakLive, snapshot.poolUsage.liveColliders);
        peakResidue = Math.max(peakResidue, snapshot.poolUsage.residueVisuals);
        const corridorCenter = safeGapCenter(pattern, tick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state !== "flight"
            || !projectile.collisionEnabled
            || projectile.position.y < 476
            || projectile.position.y > 622
          ) continue;
          minimumCollisionMargin = Math.min(
            minimumCollisionMargin,
            Math.abs(projectile.position.x - corridorCenter) - (
              safeGapWidth(pattern, difficulty) / 2
              + projectile.collisionRadiusPx
              + 2
            ),
          );
        }
      }
      const snapshot = kernel.snapshot();
      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      expect([...new Set(events.map((event) => event.id))]
        .every((id) => allowedEventIds.has(id))).toBe(true);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect({
        rng: snapshot.rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        armBegin: count("projectile.arm.begin"),
        armed: count("projectile.armed"),
        flight: count("projectile.flight.begin"),
        on: count("projectile.collision.on"),
        off: count("projectile.collision.off"),
        dualOff: count("projectile.collision.off", "dual_clock_gate"),
        phaseOff: count("projectile.collision.off", "phase_gate"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        cancel: count("projectile.cancel.commit"),
        residue: count("projectile.residue.begin"),
        removed: count("projectile.residue.remove"),
        graze: count("projectile.graze.commit"),
        impact: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        evidence: snapshot.evidence.amount,
        activeResidue: snapshot.projectiles.length,
        allocated: snapshot.poolUsage.allocatedSlots.micro,
        peakLive,
        peakResidue,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        rng: facts.candidates,
        spawn: facts.candidates,
        armBegin: facts.candidates,
        armed: facts.candidates,
        flight: facts.candidates,
        on: facts.on,
        off: facts.off,
        dualOff: facts.dualOff,
        phaseOff: facts.phaseOff,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        sourceWithdrawn: 0,
        cancel: facts.candidates,
        residue: facts.candidates,
        removed: facts.removedAtEnd,
        graze: 0,
        impact: 0,
        damage: 0,
        evidence: 0,
        activeResidue: facts.activeResidue,
        allocated: facts.allocated,
        peakLive: facts.peakLive,
        peakResidue: facts.peakResidue,
        hash: facts.endHash,
      });
      expect(snapshot).toMatchObject({
        tick120: 1464,
        relativeTick120: 1464,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
        player: {health: 3},
        evidence: {amount: 0, consumedPurposeCount: 0},
        poolUsage: {liveColliders: 0, residueVisuals: facts.activeResidue},
      });
      expect(snapshot.projectiles.every((projectile) =>
        projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
      expect(kernel.projectilePoolAudit()).toEqual([]);
      expect(events.some((event) =>
        event.id.startsWith("laser.")
        || event.id.startsWith("boss.")
        || event.id.startsWith("room.")
        || event.id.startsWith("run.")
        || event.payload.reason === "source_withdrawn")).toBe(false);
      expect(events.some((event) =>
        event.tick120 === 1464 && event.id === "projectile.collision.on")).toBe(false);
      expect(kernel.canonicalEventSerialization()).not.toContain("no_dusk_clock_ticks");
      expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);

      if (difficulty === "EASY") {
        const late = snapshot.projectiles.filter((projectile) =>
          projectile.sourceId === "vertical-law" && projectile.burstIndex === 13);
        expect(late).toHaveLength(7);
        expect(late).toEqual(expect.arrayContaining(Array.from({length: 7}, () =>
          expect.objectContaining({
            state: "residue",
            collisionEnabled: false,
            spawnedAtTick: 1424,
            armAtTick: 1429,
            movedAtTick120: 1463,
            position: expect.objectContaining({y: 102.4}),
            speedPxPerSecond: 0,
            terminalCause: "cancel",
          }))));
        for (const projectile of late) {
          expect(events.some((event) =>
            event.entityStableId === projectile.instanceId
            && event.id === "projectile.collision.on")).toBe(false);
          expect(events.filter((event) =>
            event.tick120 === 1464 && event.entityStableId === projectile.instanceId)
            .map((event) => event.id)).toEqual([
              "projectile.collision.off",
              "projectile.cancel.commit",
              "projectile.residue.begin",
            ]);
        }
      }

      for (let tick120 = 1465; tick120 <= 1780; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1780,
        projectileLifecycleDrained: false,
        handoffReady: false,
      });
      expect(kernel.snapshot().projectiles).toHaveLength(facts.drainingAt1780);
      kernel.step(safeGapFollowingInput(kernel, pattern, 1781));
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1781,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
        projectileLifecycleDrained: true,
        handoffReady: true,
      });
      expect(kernel.events().filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(facts.candidates);
      expect(kernel.events().filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(facts.candidates);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.fullHash);
    }
  });

  it("keeps both gates, motion, and event identities relative to a nonzero start tick", () => {
    const pattern = executablePattern("room.polarized.no_dusk_grid");
    const offsetTick120 = 463;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.no_dusk_grid"),
      seed: NO_DUSK_GRID_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("room.polarized.no_dusk_grid"),
      seed: NO_DUSK_GRID_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number) => {
      const input = safeGapFollowingInput(kernel, pattern, relativeTick120);
      kernel.step({
        ...input,
        tick120: kernel.snapshot().startTick120 + relativeTick120,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 900; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
    expect(offset.snapshot().poolUsage).toEqual(zero.snapshot().poolUsage);
  });

  it("stays trace-identical across cadence, backlog, weather, and accessibility projections", {
    timeout: 30_000,
  }, () => {
    const targetTick120 = 1464;
    const baseline = driveNoDuskGridWithDeltas(
      Array.from({length: 366}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveNoDuskGridWithDeltas(
        Array.from({length: 732}, () => 1000 / 60),
        targetTick120,
        {weatherEvent: "sleet", reducedMotion: true, flashOff: true},
      ),
      driveNoDuskGridWithDeltas(
        Array.from({length: 1757}, () => 1000 / 144),
        targetTick120,
        {weatherEvent: "ash", reducedMotion: false, flashOff: true},
      ),
      driveNoDuskGridWithDeltas(
        [12_200],
        targetTick120,
        {weatherEvent: "clear", reducedMotion: true, flashOff: false},
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated Room Threshold transition-pattern combat capability", () => {
  it("pins the exact transition contract, adapter provenance, and immutable QA evidence", () => {
    const pattern = executablePattern("transition.room_threshold");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("transition.room_threshold"),
      seed: ROOM_THRESHOLD_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateRoomThresholdPatternContract(contract)).not.toThrow();
    expect(contract).toEqual(pattern);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.emitters)).toBe(true);
    expect(contract).toMatchObject({
      id: "transition.room_threshold",
      category: "TRANSITION",
      room: "TRANSITION",
      name: {zh: "房间阈值", en: "Room threshold"},
      intent: "旧房间的列与新房间的角度短暂重叠，之后旧规则撤回。",
      durationMs: 7800,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 737, event: "collision.arm"},
        {atMs: 737, event: "emit.begin"},
        {atMs: 3900, event: "pattern.midpoint"},
        {atMs: 7100, event: "emit.end"},
        {atMs: 7380, event: "residue.commit"},
        {atMs: 7800, event: "pattern.complete"},
      ],
      emitters: [
        {
          id: "departing-rule",
          anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
          geometry: {
            type: "line",
            variant: "old-room-columns",
            count: 8,
            baseAngleDeg: 90,
            spreadDeg: 0,
            ordering: "clockwise-then-source-index",
          },
          cadence: {startMs: 737, intervalMs: 1000, bursts: 6, intraBurstMs: 0},
          projectile: {
            archetype: "bullet.micro.notch_e",
            collisionRadiusPx: 2,
            armDelayMs: 40,
          },
          speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 128}]},
          motionStack: [
            {
              operator: "op.speed_envelope",
              params: {
                keys: [
                  {atMs: 0, multiplier: 1},
                  {atMs: 1200, multiplier: 0.55},
                ],
                interpolation: "linear",
              },
            },
            {operator: "op.linear", params: {}},
          ],
        },
        {
          id: "arriving-rule",
          anchor: {space: "viewport-normalized", x: 0.5, y: 0.14},
          geometry: {
            type: "fan",
            variant: "new-room-angle",
            count: 6,
            baseAngleDeg: 90,
            spreadDeg: 68,
            ordering: "clockwise-then-source-index",
          },
          cadence: {startMs: 1237, intervalMs: 1000, bursts: 5, intraBurstMs: 0},
          projectile: {
            archetype: "bullet.micro.notch_e",
            collisionRadiusPx: 2,
            armDelayMs: 40,
          },
          speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 146}]},
          motionStack: [
            {
              operator: "op.speed_envelope",
              params: {
                keys: [
                  {atMs: 0, multiplier: 0.55},
                  {atMs: 1200, multiplier: 1},
                ],
                interpolation: "linear",
              },
            },
            {operator: "op.linear", params: {}},
          ],
        },
      ],
      safeGap: {
        type: "threshold_bridge",
        minimumWidthPx: 46,
        focusMinimumWidthPx: 38,
        path: {
          centerX: 180,
          amplitudePx: 28,
          periodMs: 7000,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        enforcement: "phase_gate",
        compileRule:
          "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
        readability: {leadMs: 520, neverColorOnly: true},
      },
      warning: {
        durationMs: 737,
        shape: "overlap_threshold_map",
        coversSweptArea: true,
        collisionEnabled: false,
        flashIndependent: true,
      },
      cancel: {
        triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
        mode: "digital_cancel_to_material_residue",
        collisionOffBeforeVisual: true,
        eventIdempotent: true,
      },
      residue: {
        type: "threshold_sediment",
        lifetimeMs: 2741,
        density: 0.37,
        inheritsSourceId: true,
        gameplayCollision: false,
      },
      seed: {
        algorithm: "mulberry32-v1",
        base: 577557179,
        composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
        randomCalls: "emitter-order then burst-order then projectile-order",
      },
    });
    expect("laserGeometry" in contract).toBe(false);
    expect("resolutionHook" in contract).toBe(false);
    expect(kernel.snapshot().adapterGaps.roomThresholdPhaseGate).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      declarationOrder: "speed-envelope>linear>continuous-threshold-bridge-collision-mask",
      thresholdBridgeSweep: "analytic-relative-sine-extrema-then-bisection",
      phaseGapBehavior: "same-generation-motion-retained-collision-off",
      collisionLease: "reversible-entity-owned-canonical-events",
      transitionAuthority:
        "withheld-no-room-transition-composer-session-renderer-or-room-completion",
      completeTickTie: "pattern-end-cancels-live-identities-before-mask-update",
    });

    expect(patternStructureReportJson.patterns.find((entry) =>
      entry.patternId === pattern.id)).toEqual({
      patternId: pattern.id,
      sha256: "de88365e1c85d565eec9997191f184ecfc057a3d2744e3185aa44b8e685529a5",
      normalized: {
        emitterCount: 2,
        emitters: [
          {
            geometry: "line",
            countBand: 2,
            spreadBand: 0,
            cadenceBand: 6,
            burstBand: 2,
            speedKeyCount: 1,
            speedDirection: "flat",
            operators: ["op.speed_envelope", "op.linear"],
            parameterShapes: [["interpolation", "keys"], []],
          },
          {
            geometry: "fan",
            countBand: 2,
            spreadBand: 2,
            cadenceBand: 6,
            burstBand: 1,
            speedKeyCount: 1,
            speedDirection: "flat",
            operators: ["op.speed_envelope", "op.linear"],
            parameterShapes: [["interpolation", "keys"], []],
          },
        ],
        gap: ["threshold_bridge", "phase_gate", 11],
        warning: "overlap_threshold_map",
        timelineRatios: [0, 0.09, 0.09, 0.5, 0.91, 0.95, 1],
        hasLaser: false,
      },
    });
    expect(safeGapReportJson.patterns.find((entry) => entry.patternId === pattern.id))
      .toMatchObject({
        gapType: "threshold_bridge",
        widthPx: 46,
        enforcement: "phase_gate",
        normal: {
          pass: true,
          minimumClearancePx: 26.637,
          sampleCount: 79,
          pathHash: "6bf60e85111ae26498923360c571fbc438a6b45eceeca0325b825645d9f08665",
        },
        focus: {
          pass: true,
          minimumClearancePx: 27.637,
          sampleCount: 79,
          pathHash: "6bf60e85111ae26498923360c571fbc438a6b45eceeca0325b825645d9f08665",
        },
        pass: true,
      });

    const expectedOracle = {
      EASY: [11, 61, 6, "46f93363fad94f5e8df59e793844758737cbbe0887e63a95d4228fd9692b4c8e"],
      NORMAL: [11, 78, 6, "0c483797777dc1fcdb1102982ad58d618422f0acd25729f892e2d93f45b42c8c"],
      HARD: [11, 89, 12, "7f2600cfa4ca0a2cceb26dcdcb7759c032290e7bd0e878b8d9759270a2d77aff"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: ROOM_THRESHOLD_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: ROOM_THRESHOLD_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expectedOracle[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("fails closed on hostile drift and remains private from live admission and transition completion", () => {
    const source = structuredClone(executablePattern("transition.room_threshold")) as unknown as {
      durationMs: number;
      safeGap: {type: string; enforcement: string};
      emitters: Array<{
        id: string;
        geometry: {type: string; count: number};
        motionStack: Array<{
          operator: string;
          params: {keys?: Array<{atMs: number; multiplier: number}>};
        }>;
      }>;
      metadata?: string;
    };
    expect(() => validateRoomThresholdPatternContract(source)).not.toThrow();

    const extra = structuredClone(source);
    extra.metadata = "room-transition-write-back";
    expect(() => validateRoomThresholdPatternContract(extra)).toThrow(/contract drifted/);
    const durationDrift = structuredClone(source);
    durationDrift.durationMs += 1;
    expect(() => validateRoomThresholdPatternContract(durationDrift)).toThrow(/contract drifted/);
    const gapDrift = structuredClone(source);
    gapDrift.safeGap.type = "dual_clock_intersection";
    expect(() => validateRoomThresholdPatternContract(gapDrift)).toThrow(/contract drifted/);
    const policyDrift = structuredClone(source);
    policyDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateRoomThresholdPatternContract(policyDrift)).toThrow(/contract drifted/);
    const geometryDrift = structuredClone(source);
    geometryDrift.emitters[0]!.geometry.type = "wall";
    expect(() => validateRoomThresholdPatternContract(geometryDrift)).toThrow(/contract drifted/);
    const emitterOrderDrift = structuredClone(source);
    emitterOrderDrift.emitters.reverse();
    expect(() => validateRoomThresholdPatternContract(emitterOrderDrift)).toThrow(/contract drifted/);
    const envelopeDrift = structuredClone(source);
    envelopeDrift.emitters[1]!.motionStack[0]!.params.keys![1]!.multiplier = 0.99;
    expect(() => validateRoomThresholdPatternContract(envelopeDrift)).toThrow(/contract drifted/);
    const operatorOrderDrift = structuredClone(source);
    operatorOrderDrift.emitters[0]!.motionStack.reverse();
    expect(() => validateRoomThresholdPatternContract(operatorOrderDrift)).toThrow(/contract drifted/);
    const hiddenDuration = structuredClone(source);
    Object.defineProperty(hiddenDuration, "durationMs", {
      value: source.durationMs,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    expect(() => validateRoomThresholdPatternContract(hiddenDuration))
      .toThrow(/enumerable own data property/);

    let safeGapReads = 0;
    const accessorPattern = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        safeGapReads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateRoomThresholdPatternContract(accessorPattern))
      .toThrow(/own data property/);
    expect(safeGapReads).toBe(0);
    let envelopeReads = 0;
    const nestedAccessor = structuredClone(source);
    Object.defineProperty(
      nestedAccessor.emitters[1]!.motionStack[0]!.params.keys![1]!,
      "multiplier",
      {
        enumerable: true,
        get() {
          envelopeReads += 1;
          return 1;
        },
      },
    );
    expect(() => validateRoomThresholdPatternContract(nestedAccessor))
      .toThrow(/own data property/);
    expect(envelopeReads).toBe(0);
    const revoked = Proxy.revocable(structuredClone(source), {});
    revoked.revoke();
    expect(() => validateRoomThresholdPatternContract(revoked.proxy)).toThrow();

    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS)
      .not.toContain("transition.room_threshold");
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("transition.room_threshold"),
      seed: ROOM_THRESHOLD_REPORT_SEED,
    })).not.toThrow();
  });

  it("preserves exact E\/N\/H cadence, geometry, envelope direction, sine path, and RNG identity", () => {
    const pattern = executablePattern("transition.room_threshold");
    const expected = {
      EASY: {
        departingCount: 6,
        arrivingCount: 5,
        candidates: 61,
        departingSpeed: 112.64,
        arrivingSpeed: 128.48,
        gap: 54,
        departingSpawn: [89, 228, 367, 507, 646, 785],
        departingArm: [94, 233, 372, 511, 651, 790],
        arrivingSpawn: [149, 288, 427, 567, 706],
        arrivingArm: [154, 293, 432, 571, 711],
      },
      NORMAL: {
        departingCount: 8,
        arrivingCount: 6,
        candidates: 78,
        departingSpeed: 128,
        arrivingSpeed: 146,
        gap: 46,
        departingSpawn: [89, 209, 329, 449, 569, 689],
        departingArm: [94, 214, 334, 454, 574, 694],
        arrivingSpawn: [149, 269, 389, 509, 629],
        arrivingArm: [154, 274, 394, 514, 634],
      },
      HARD: {
        departingCount: 9,
        arrivingCount: 7,
        candidates: 89,
        departingSpeed: 143.36,
        arrivingSpeed: 163.52,
        gap: 42,
        departingSpawn: [89, 195, 300, 406, 511, 617],
        departingArm: [94, 199, 305, 411, 516, 622],
        arrivingSpawn: [149, 255, 360, 466, 571],
        arrivingArm: [154, 259, 365, 471, 576],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const schedule = createPatternSchedule(pattern, difficulty);
      const departing = schedule.filter((entry) => entry.emitter.id === "departing-rule");
      const arriving = schedule.filter((entry) => entry.emitter.id === "arriving-rule");
      expect(departing.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(facts.departingSpawn);
      expect(departing.map((entry) => crossedTickCount(entry.atMs + 40)))
        .toEqual(facts.departingArm);
      expect(arriving.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(facts.arrivingSpawn);
      expect(arriving.map((entry) => crossedTickCount(entry.atMs + 40)))
        .toEqual(facts.arrivingArm);
      expect(schedule.map((entry) => entry.emitter.id[0])).toEqual([
        "d", "a", "d", "a", "d", "a", "d", "a", "d", "a", "d",
      ]);
      expect(roundPatternCount(8 * pattern.difficulty[difficulty].countMultiplier))
        .toBe(facts.departingCount);
      expect(roundPatternCount(6 * pattern.difficulty[difficulty].countMultiplier))
        .toBe(facts.arrivingCount);
      expect(6 * facts.departingCount + 5 * facts.arrivingCount).toBe(facts.candidates);
      expect(128 * pattern.difficulty[difficulty].speedMultiplier)
        .toBeCloseTo(facts.departingSpeed, 12);
      expect(146 * pattern.difficulty[difficulty].speedMultiplier)
        .toBeCloseTo(facts.arrivingSpeed, 12);
      expect(safeGapWidth(pattern, difficulty)).toBe(facts.gap);
    }
    expect([0, 737, 737, 3900, 7100, 7380, 7800].map(crossedTickCount))
      .toEqual([0, 89, 89, 468, 852, 886, 936]);
    expect(crossedTickCount(2741)).toBe(329);
    expect([0, 210, 420, 630, 840].map((tick120) =>
      safeGapCenter(pattern, tick120 * 1000 / 120)))
      .toEqual([180, 208, 180, 152, 180]);

    const schedule = createPatternSchedule(pattern, "NORMAL");
    const departing = schedule.find((entry) => entry.emitter.id === "departing-rule")!;
    const arriving = schedule.find((entry) => entry.emitter.id === "arriving-rule")!;
    expect(geometryCandidates(departing.emitter, 0, 8).map((entry) => entry.x)).toEqual([
      36.5, 77.5, 118.5, 159.5, 200.5, 241.5, 282.5, 323.5,
    ]);
    expect(geometryCandidates(departing.emitter, 0, 8).map((entry) => entry.headingDeg))
      .toEqual(Array.from({length: 8}, () => 90));
    expect(geometryCandidates(arriving.emitter, 0, 6).map((entry) => entry.headingDeg))
      .toEqual([56, 69.6, 83.2, 96.8, 110.4, 124]);

    const rngKernel = new CanonicalCombatKernel({
      ...optionsFor("transition.room_threshold"),
      seed: ROOM_THRESHOLD_REPORT_SEED,
    });
    for (let tick120 = 1; tick120 <= 149; tick120 += 1) {
      rngKernel.step(safeGapFollowingInput(rngKernel, pattern, tick120));
      if (tick120 === 89) expect(rngKernel.snapshot().rngCallsConsumed).toBe(8);
    }
    expect(rngKernel.snapshot().rngCallsConsumed).toBe(14);
    expect(rngKernel.snapshot().projectiles.find((projectile) =>
      projectile.sourceId === "departing-rule" && projectile.sourceIndex === 0)?.headingDegrees)
      .toBe(90);
  });

  it("applies the opposite linear envelopes and masks the sine bridge without freezing motion", () => {
    const pattern = executablePattern("transition.room_threshold");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("transition.room_threshold"),
      seed: ROOM_THRESHOLD_REPORT_SEED,
    });
    const sampleTicks = new Set([94, 95, 154, 155, 233, 294, 676, 677, 678, 872, 873, 874]);
    const samples = new Map<number, ReturnType<CanonicalCombatKernel["snapshot"]>>();
    for (let tick120 = 1; tick120 <= 874; tick120 += 1) {
      const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      if (sampleTicks.has(tick120)) samples.set(tick120, snapshot);
    }
    const projectileAt = (
      tick120: number,
      sourceId: "departing-rule" | "arriving-rule",
      sourceIndex: number,
    ) => {
      const projectile = samples.get(tick120)?.projectiles.find((entry) =>
        entry.sourceId === sourceId && entry.burstIndex === 0 && entry.sourceIndex === sourceIndex);
      expect(projectile, `${sourceId}/${sourceIndex} at ${tick120}`).toBeDefined();
      return projectile as NonNullable<typeof projectile>;
    };

    const departingArm = projectileAt(94, "departing-rule", 3);
    expect(departingArm).toMatchObject({
      state: "flight",
      collisionEnabled: true,
      speedPxPerSecond: 128,
      position: {x: 159.5, y: 102.4},
      spawnedAtTick: 89,
      armAtTick: 94,
    });
    expect(projectileAt(95, "departing-rule", 3)).toMatchObject({
      instanceId: departingArm.instanceId,
      speedPxPerSecond: 125.376,
      position: {x: 159.5, y: 103.44646666666668},
    });
    expect(projectileAt(233, "departing-rule", 3).speedPxPerSecond).toBeCloseTo(70.4, 12);

    const arrivingArm = projectileAt(154, "arriving-rule", 2);
    expect(arrivingArm).toMatchObject({
      state: "flight",
      collisionEnabled: true,
      speedPxPerSecond: 80.30000000000001,
      position: {x: 180, y: 89.60000000000001},
      spawnedAtTick: 149,
      armAtTick: 154,
    });
    expect(projectileAt(155, "arriving-rule", 2)).toMatchObject({
      instanceId: arrivingArm.instanceId,
      speedPxPerSecond: 83.29300000000002,
    });
    expect(projectileAt(294, "arriving-rule", 2).speedPxPerSecond).toBe(146);

    const phaseBefore = projectileAt(676, "departing-rule", 3);
    const phaseMasked = projectileAt(677, "departing-rule", 3);
    expect(phaseBefore).toMatchObject({collisionEnabled: true, speedPxPerSecond: 70.4});
    expect(phaseBefore.position.y).toBeCloseTo(475.78272266666903, 12);
    expect(phaseMasked).toMatchObject({
      instanceId: phaseBefore.instanceId,
      generation: phaseBefore.generation,
      collisionEnabled: false,
      speedPxPerSecond: 70.4,
    });
    expect(phaseMasked.position.y - phaseBefore.position.y).toBeCloseTo(70.4 / 120, 12);
    expect(projectileAt(678, "departing-rule", 3).position.y - phaseMasked.position.y)
      .toBeCloseTo(70.4 / 120, 12);
    expect(projectileAt(872, "departing-rule", 3)).toMatchObject({
      collisionEnabled: false,
      speedPxPerSecond: 70.4,
    });
    const phaseReopened = projectileAt(873, "departing-rule", 3);
    expect(phaseReopened).toMatchObject({
      instanceId: phaseBefore.instanceId,
      generation: phaseBefore.generation,
      collisionEnabled: true,
      speedPxPerSecond: 70.4,
    });
    expect(phaseReopened.position.y - projectileAt(872, "departing-rule", 3).position.y)
      .toBeCloseTo(70.4 / 120, 12);
    expect(projectileAt(874, "departing-rule", 3).position.y - phaseReopened.position.y)
      .toBeCloseTo(70.4 / 120, 12);
    expect(kernel.events()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 677,
        entityStableId: phaseBefore.instanceId,
        payload: expect.objectContaining({reason: "phase_gate"}),
      }),
      expect.objectContaining({
        id: "projectile.collision.on",
        tick120: 873,
        entityStableId: phaseBefore.instanceId,
      }),
    ]));
    expect(kernel.events().some((event) =>
      event.entityStableId === phaseBefore.instanceId
      && event.payload.reason === "source_withdrawn")).toBe(false);
    expect(kernel.snapshot()).toMatchObject({player: {health: 3}, evidence: {amount: 0}});
    expect(new Set(kernel.events().map((event) => event.occurrenceKey)).size)
      .toBe(kernel.events().length);
  });

  it("retains every E\/N\/H identity, protects the bridge, and drains threshold sediment exactly", {
    timeout: 30_000,
  }, () => {
    const pattern = executablePattern("transition.room_threshold");
    const allowedEventIds = new Set([
      "projectile.arm.begin",
      "projectile.armed",
      "projectile.cancel.commit",
      "projectile.collision.off",
      "projectile.collision.on",
      "projectile.flight.begin",
      "projectile.lifecycle.complete",
      "projectile.residue.begin",
      "projectile.residue.remove",
      "projectile.spawn.commit",
    ]);
    const expected = {
      EASY: {
        candidates: 61,
        on: 64,
        off: 67,
        phaseOff: 6,
        outOfBounds: 9,
        patternEnd: 52,
        removedAtEnd: 0,
        activeResidue: 61,
        allocated: 61,
        peakLive: 55,
        peakResidue: 61,
        endHash: "36e3b5c511d7a42d46dfef94c54a0cced93d9392800351e0cc3228ecf378a6ae",
        fullHash: "dc6a4490094f45d876b10535843dbb3734548fd19fa0d6125b4878ab2da7825b",
      },
      NORMAL: {
        candidates: 78,
        on: 81,
        off: 84,
        phaseOff: 6,
        outOfBounds: 14,
        patternEnd: 64,
        removedAtEnd: 2,
        activeResidue: 76,
        allocated: 78,
        peakLive: 75,
        peakResidue: 76,
        endHash: "92d7ea69574d22a1cfe8c1b2fd3fdd07a28293028358d221140ed163dfdb07d5",
        fullHash: "ebba622fef62ef1b1568552d903134159ec1a4558e13478b90b131b96e9168b9",
      },
      HARD: {
        candidates: 89,
        on: 97,
        off: 102,
        phaseOff: 13,
        outOfBounds: 23,
        patternEnd: 66,
        removedAtEnd: 2,
        activeResidue: 87,
        allocated: 89,
        peakLive: 86,
        peakResidue: 87,
        endHash: "c48b285bdb2fe89b4fe593c73f45d8921784d43d6ff0899ef5b7c091ec7d9e59",
        fullHash: "f63a5bc9a19083154b1b69fb95a47ce0186c124e3e496f4646fd6d9cc5e5c072",
      },
    } as const;

    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("transition.room_threshold"),
        seed: ROOM_THRESHOLD_REPORT_SEED,
        difficulty,
      });
      let peakLive = 0;
      let peakResidue = 0;
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      for (let tick120 = 1; tick120 <= 936; tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        peakLive = Math.max(peakLive, snapshot.poolUsage.liveColliders);
        peakResidue = Math.max(peakResidue, snapshot.poolUsage.residueVisuals);
        const corridorCenter = safeGapCenter(pattern, tick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state !== "flight"
            || !projectile.collisionEnabled
            || projectile.position.y < 476
            || projectile.position.y > 622
          ) continue;
          minimumCollisionMargin = Math.min(
            minimumCollisionMargin,
            Math.abs(projectile.position.x - corridorCenter) - (
              safeGapWidth(pattern, difficulty) / 2
              + projectile.collisionRadiusPx
              + 2
            ),
          );
        }
      }
      const snapshot = kernel.snapshot();
      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      expect([...new Set(events.map((event) => event.id))]
        .every((id) => allowedEventIds.has(id))).toBe(true);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect({
        rng: snapshot.rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        armBegin: count("projectile.arm.begin"),
        armed: count("projectile.armed"),
        flight: count("projectile.flight.begin"),
        on: count("projectile.collision.on"),
        off: count("projectile.collision.off"),
        phaseOff: count("projectile.collision.off", "phase_gate"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
        cancel: count("projectile.cancel.commit"),
        residue: count("projectile.residue.begin"),
        removed: count("projectile.residue.remove"),
        graze: count("projectile.graze.commit"),
        impact: count("projectile.impact.commit"),
        damage: count("player.damage.commit"),
        evidence: snapshot.evidence.amount,
        activeResidue: snapshot.projectiles.length,
        allocated: snapshot.poolUsage.allocatedSlots.micro,
        peakLive,
        peakResidue,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        rng: facts.candidates,
        spawn: facts.candidates,
        armBegin: facts.candidates,
        armed: facts.candidates,
        flight: facts.candidates,
        on: facts.on,
        off: facts.off,
        phaseOff: facts.phaseOff,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        sourceWithdrawn: 0,
        cancel: facts.candidates,
        residue: facts.candidates,
        removed: facts.removedAtEnd,
        graze: 0,
        impact: 0,
        damage: 0,
        evidence: 0,
        activeResidue: facts.activeResidue,
        allocated: facts.allocated,
        peakLive: facts.peakLive,
        peakResidue: facts.peakResidue,
        hash: facts.endHash,
      });
      expect(snapshot).toMatchObject({
        tick120: 936,
        relativeTick120: 936,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
        player: {health: 3},
        evidence: {amount: 0, consumedPurposeCount: 0},
        poolUsage: {liveColliders: 0, residueVisuals: facts.activeResidue},
      });
      expect(snapshot.projectiles.every((projectile) =>
        projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
      expect(kernel.projectilePoolAudit()).toEqual([]);
      expect(events.some((event) =>
        event.id.startsWith("laser.")
        || event.id.startsWith("boss.")
        || event.id.startsWith("room.")
        || event.id.startsWith("run.")
        || event.payload.reason === "source_withdrawn")).toBe(false);
      expect(events.some((event) =>
        event.tick120 === 936 && event.id === "projectile.collision.on")).toBe(false);
      expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);

      for (let tick120 = 937; tick120 <= 1264; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1264,
        projectileLifecycleDrained: false,
        handoffReady: false,
      });
      kernel.step(safeGapFollowingInput(kernel, pattern, 1265));
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1265,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
        projectileLifecycleDrained: true,
        handoffReady: true,
      });
      expect(kernel.events().filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(facts.candidates);
      expect(kernel.events().filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(facts.candidates);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.fullHash);
    }
  });

  it("keeps the envelope, sine mask, and event identities relative to a nonzero start tick", () => {
    const pattern = executablePattern("transition.room_threshold");
    const offsetTick120 = 347;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("transition.room_threshold"),
      seed: ROOM_THRESHOLD_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("transition.room_threshold"),
      seed: ROOM_THRESHOLD_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number) => {
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120: kernel.snapshot().startTick120 + relativeTick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 900; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
    expect(offset.snapshot().poolUsage).toEqual(zero.snapshot().poolUsage);
  });

  it("stays trace-identical across cadence, backlog, weather, and accessibility projections", {
    timeout: 20_000,
  }, () => {
    const targetTick120 = 936;
    const baseline = driveRoomThresholdWithDeltas(
      Array.from({length: 234}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveRoomThresholdWithDeltas(
        Array.from({length: 468}, () => 1000 / 60),
        targetTick120,
        0,
        {weatherEvent: "sleet", reducedMotion: true, flashOff: true},
      ),
      driveRoomThresholdWithDeltas(
        Array.from({length: 1124}, () => 1000 / 144),
        targetTick120,
        0,
        {weatherEvent: "ash", reducedMotion: false, flashOff: true},
      ),
      driveRoomThresholdWithDeltas(
        [7800],
        targetTick120,
        0,
        {weatherEvent: "clear", reducedMotion: true, flashOff: false},
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated Stable Intersection room-pattern combat capability", () => {
  it("pins the exact room contract, inert hook seam, and immutable QA evidence", () => {
    const pattern = executablePattern("room.in_between.stable_intersection");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.stable_intersection"),
      seed: STABLE_INTERSECTION_REPORT_SEED,
    });
    const contract = kernel.patternContractSnapshot();
    expect(() => validateStableIntersectionPatternContract(contract)).not.toThrow();
    expect(contract).toEqual(pattern);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.emitters)).toBe(true);
    expect(contract).toMatchObject({
      id: "room.in_between.stable_intersection",
      category: "ROOM",
      room: "IN_BETWEEN",
      name: {zh: "稳定交集", en: "Stable intersection"},
      intent: "双时钟同时打开的短窗口形成可学习的交集。",
      durationMs: 12400,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 682, event: "collision.arm"},
        {atMs: 682, event: "emit.begin"},
        {atMs: 6200, event: "pattern.midpoint"},
        {atMs: 11700, event: "emit.end"},
        {atMs: 11980, event: "residue.commit"},
        {atMs: 12400, event: "pattern.complete"},
      ],
      emitters: [
        {
          id: "orthogonal-a",
          geometry: {
            type: "lattice",
            variant: "horizontal-clock",
            count: 12,
            baseAngleDeg: 90,
            spreadDeg: 0,
          },
          cadence: {startMs: 682, intervalMs: 720, bursts: 15, intraBurstMs: 0},
          motionStack: [
            {
              operator: "op.dual_clock_gate",
              params: {
                periodAMs: 1600,
                periodBMs: 2400,
                dutyA: 0.5,
                dutyB: 0.34,
                phaseOffsetMs: 0,
              },
            },
            {operator: "op.linear", params: {}},
          ],
        },
        {
          id: "diagonal-b",
          geometry: {
            type: "lattice",
            variant: "diagonal-clock",
            count: 10,
            baseAngleDeg: 74,
            spreadDeg: 46,
          },
          cadence: {startMs: 882, intervalMs: 960, bursts: 12, intraBurstMs: 0},
          motionStack: [
            {
              operator: "op.dual_clock_gate",
              params: {
                periodAMs: 2400,
                periodBMs: 1600,
                dutyA: 0.34,
                dutyB: 0.5,
                phaseOffsetMs: 400,
              },
            },
            {operator: "op.linear", params: {}},
          ],
        },
      ],
      safeGap: {
        type: "dual_clock_intersection",
        minimumWidthPx: 44,
        focusMinimumWidthPx: 36,
        path: {
          centerX: 180,
          amplitudePx: 16,
          periodMs: 6600,
          phase: 0,
          laneX: [],
          maxTravelPxPerSec: 78,
        },
        enforcement: "phase_gate",
      },
      warning: {durationMs: 682, shape: "clock_intersection_cells"},
      residue: {type: "misregistration_flake", lifetimeMs: 3155, density: 0.23},
      seed: {
        algorithm: "mulberry32-v1",
        base: 3179525433,
        composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
        randomCalls: "emitter-order then burst-order then projectile-order",
      },
      resolutionHook: "intersection_hold_ms",
    });
    expect(kernel.snapshot().adapterGaps.stableIntersectionPhaseGate).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      clockIdentity: "pattern-relative-integer-tick120",
      effectiveGate:
        "dual-clock-xor-plus-both-open-intersection-plus-continuous-sine-collision-mask",
      intersectionRule: "python-oracle-a-or-b-from-xor-plus-both-open",
      corridorSweep: "analytic-relative-sine-extrema-then-bisection",
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off",
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick",
      phaseGapBehavior: "same-generation-motion-retained-collision-off",
      collisionLease: "reversible-entity-owned-canonical-events",
      resolutionHook: "validated-inert-no-metric-or-room-completion",
      roomAuthority: "withheld-no-composer-session-handoff-renderer-or-default-run",
      completeTickTie: "pattern-end-cancels-live-identities-before-gate-update",
    });

    expect(patternStructureReportJson.patterns.find((entry) =>
      entry.patternId === pattern.id)).toEqual({
      patternId: pattern.id,
      sha256: "5c55c7976d83c708f4fc7c7ca3051f958aff87dacb1030054dfaae2633ced1c9",
      normalized: {
        emitterCount: 2,
        emitters: [
          {
            geometry: "lattice",
            countBand: 4,
            spreadBand: 0,
            cadenceBand: 4,
            burstBand: 5,
            speedKeyCount: 1,
            speedDirection: "flat",
            operators: ["op.dual_clock_gate", "op.linear"],
            parameterShapes: [
              ["dutyA", "dutyB", "periodAMs", "periodBMs", "phaseOffsetMs"],
              [],
            ],
          },
          {
            geometry: "lattice",
            countBand: 3,
            spreadBand: 1,
            cadenceBand: 6,
            burstBand: 4,
            speedKeyCount: 1,
            speedDirection: "flat",
            operators: ["op.dual_clock_gate", "op.linear"],
            parameterShapes: [
              ["dutyA", "dutyB", "periodAMs", "periodBMs", "phaseOffsetMs"],
              [],
            ],
          },
        ],
        gap: ["dual_clock_intersection", "phase_gate", 11],
        warning: "clock_intersection_cells",
        timelineRatios: [0, 0.06, 0.06, 0.5, 0.94, 0.97, 1],
        hasLaser: false,
      },
    });
    expect(safeGapReportJson.patterns.find((entry) => entry.patternId === pattern.id))
      .toMatchObject({
        gapType: "dual_clock_intersection",
        widthPx: 44,
        enforcement: "phase_gate",
        normal: {
          pass: true,
          minimumClearancePx: 24.395,
          sampleCount: 125,
          pathHash: "0b9d1a190a814fce978bd5124ae7ad8bcd4a97587bb88d0a41a4bc4659e0ad6e",
        },
        focus: {
          pass: true,
          minimumClearancePx: 25.395,
          sampleCount: 125,
          pathHash: "0b9d1a190a814fce978bd5124ae7ad8bcd4a97587bb88d0a41a4bc4659e0ad6e",
        },
        pass: true,
      });

    const expectedOracle = {
      EASY: [26, 223, 16, "1f5e7cecbfc7dfd3edb0813eee1489deda66b68b862e295445dd845db650aef5"],
      NORMAL: [27, 300, 26, "5dba80afbfc2c9e1b835d3bca1e13237b23de32d79706597fb8396b708b7fd83"],
      HARD: [27, 354, 31, "ef17e7df7416b4b33a78dceda0b5b4945dfa6c488d2a0420cd3088aecb6e44f8"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: STABLE_INTERSECTION_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: STABLE_INTERSECTION_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      expect([
        reference.events.length,
        reference.events.reduce((total, event) => total + event.count, 0),
        reference.omittedOrRedirected,
        reference.traceSha256,
      ]).toEqual(expectedOracle[difficulty]);
      expect(declared.traceSha256).toBe(reference.traceSha256);
      expect(reference.splitChildren).toBe(0);
    }
  });

  it("fails closed on hostile drift and remains private from room and live-run authority", () => {
    const source = structuredClone(
      executablePattern("room.in_between.stable_intersection"),
    ) as unknown as {
      durationMs: number;
      resolutionHook: string;
      safeGap: {type: string; enforcement: string};
      emitters: Array<{
        geometry: {type: string; count: number};
        motionStack: Array<{
          operator: string;
          params: {dutyA?: number; phaseOffsetMs?: number};
        }>;
      }>;
      metadata?: string;
    };
    expect(() => validateStableIntersectionPatternContract(source)).not.toThrow();
    expect(() => validateLatticeGeometryContract(source.emitters[0]!.geometry)).not.toThrow();

    const extra = structuredClone(source);
    extra.metadata = "room-completion-write-back";
    expect(() => validateStableIntersectionPatternContract(extra)).toThrow(/contract drifted/);
    const durationDrift = structuredClone(source);
    durationDrift.durationMs += 1;
    expect(() => validateStableIntersectionPatternContract(durationDrift)).toThrow(/contract drifted/);
    const hookDrift = structuredClone(source);
    hookDrift.resolutionHook = "automatic_room_complete";
    expect(() => validateStableIntersectionPatternContract(hookDrift)).toThrow(/contract drifted/);
    const gapDrift = structuredClone(source);
    gapDrift.safeGap.type = "quantized_step";
    expect(() => validateStableIntersectionPatternContract(gapDrift)).toThrow(/contract drifted/);
    const policyDrift = structuredClone(source);
    policyDrift.safeGap.enforcement = "spawn_omission";
    expect(() => validateStableIntersectionPatternContract(policyDrift)).toThrow(/contract drifted/);
    const geometryDrift = structuredClone(source);
    geometryDrift.emitters[0]!.geometry.type = "grid";
    expect(() => validateStableIntersectionPatternContract(geometryDrift)).toThrow(/contract drifted/);
    expect(() => validateLatticeGeometryContract(geometryDrift.emitters[0]!.geometry))
      .toThrow(/type must be lattice/);
    const clockDrift = structuredClone(source);
    clockDrift.emitters[1]!.motionStack[0]!.params.dutyA = 0.35;
    expect(() => validateStableIntersectionPatternContract(clockDrift)).toThrow(/contract drifted/);
    const emitterOrderDrift = structuredClone(source);
    emitterOrderDrift.emitters.reverse();
    expect(() => validateStableIntersectionPatternContract(emitterOrderDrift))
      .toThrow(/contract drifted/);
    const operatorOrderDrift = structuredClone(source);
    operatorOrderDrift.emitters[0]!.motionStack.reverse();
    expect(() => validateStableIntersectionPatternContract(operatorOrderDrift))
      .toThrow(/contract drifted/);

    const hiddenHook = structuredClone(source);
    Object.defineProperty(hiddenHook, "resolutionHook", {
      value: source.resolutionHook,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    expect(() => validateStableIntersectionPatternContract(hiddenHook))
      .toThrow(/enumerable own data property/);
    let safeGapReads = 0;
    const accessorPattern = Object.defineProperty(structuredClone(source), "safeGap", {
      enumerable: true,
      get() {
        safeGapReads += 1;
        return source.safeGap;
      },
    });
    expect(() => validateStableIntersectionPatternContract(accessorPattern))
      .toThrow(/own data property/);
    expect(safeGapReads).toBe(0);
    let dutyReads = 0;
    const nestedAccessor = structuredClone(source);
    Object.defineProperty(nestedAccessor.emitters[0]!.motionStack[0]!.params, "dutyA", {
      enumerable: true,
      get() {
        dutyReads += 1;
        return 0.5;
      },
    });
    expect(() => validateStableIntersectionPatternContract(nestedAccessor))
      .toThrow(/own data property/);
    expect(dutyReads).toBe(0);
    const revoked = Proxy.revocable(structuredClone(source), {});
    revoked.revoke();
    expect(() => validateStableIntersectionPatternContract(revoked.proxy)).toThrow();

    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS)
      .not.toContain("room.in_between.stable_intersection");
    expect(() => new CanonicalCombatKernel({
      ...optionsFor("room.in_between.stable_intersection"),
      seed: STABLE_INTERSECTION_REPORT_SEED,
    })).not.toThrow();
  });

  it("preserves exact E\/N\/H cadence, lattice candidates, sine path, and RNG identity", () => {
    const pattern = executablePattern("room.in_between.stable_intersection");
    const expected = {
      EASY: {
        candidates: 223,
        gap: 52,
        orthogonal: [82, 183, 283, 383, 483, 583, 684, 784, 884, 984, 1085, 1185, 1285, 1385, 1485],
        diagonal: [106, 240, 374, 507, 641, 774, 908, 1042, 1175, 1309, 1443],
      },
      NORMAL: {
        candidates: 300,
        gap: 44,
        orthogonal: [82, 169, 255, 342, 428, 514, 601, 687, 774, 860, 946, 1033, 1119, 1206, 1292],
        diagonal: [106, 222, 337, 452, 567, 682, 798, 913, 1028, 1143, 1258, 1374],
      },
      HARD: {
        candidates: 354,
        gap: 40,
        orthogonal: [82, 158, 234, 310, 386, 462, 539, 615, 691, 767, 843, 919, 995, 1071, 1147],
        diagonal: [106, 208, 309, 410, 512, 613, 715, 816, 917, 1019, 1120, 1221],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      const spawnTicks = (sourceId: string) => schedule
        .filter((entry) => entry.emitter.id === sourceId)
        .map((entry) => crossedTickCount(entry.atMs));
      expect(spawnTicks("orthogonal-a")).toEqual(expected[difficulty].orthogonal);
      expect(spawnTicks("diagonal-b")).toEqual(expected[difficulty].diagonal);
      expect(schedule.reduce((total, entry) => total + roundPatternCount(
        entry.emitter.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      ), 0)).toBe(expected[difficulty].candidates);
      expect(safeGapWidth(pattern, difficulty)).toBe(expected[difficulty].gap);
    }
    expect([0, 682, 682, 6200, 11700, 11980, 12400].map(crossedTickCount))
      .toEqual([0, 82, 82, 744, 1404, 1438, 1488]);
    expect(crossedTickCount(3155)).toBe(379);
    expect([0, 198, 396, 594, 792].map((tick120) =>
      safeGapCenter(pattern, tick120 * 1000 / 120)))
      .toEqual([180, 196, 180, 164, 180]);

    const orthogonal = geometryCandidates(pattern.emitters[0]!, 0, 12);
    expect(orthogonal).toHaveLength(12);
    expect(orthogonal[0]).toEqual({
      x: 29.666666666666664,
      y: 19.2,
      headingDeg: 90,
      sourceIndex: 0,
    });
    expect(orthogonal[11]).toEqual({
      x: 330.33333333333337,
      y: 19.2,
      headingDeg: 90,
      sourceIndex: 11,
    });
    const diagonal = geometryCandidates(pattern.emitters[1]!, 0, 10);
    expect(diagonal).toHaveLength(10);
    expect(diagonal[0]).toEqual({
      x: 32.400000000000006,
      y: 51.2,
      headingDeg: 51,
      sourceIndex: 0,
    });
    expect(diagonal[9]).toEqual({
      x: 327.59999999999997,
      y: 51.2,
      headingDeg: 97,
      sourceIndex: 9,
    });

    const easySchedule = createPatternSchedule(pattern, "EASY");
    const late = easySchedule.find((entry) =>
      entry.emitter.id === "orthogonal-a" && entry.burstIndex === 14);
    expect(late).toMatchObject({atMs: 12374.8, burstIndex: 14});
    expect(crossedTickCount(late!.atMs)).toBe(1485);
    expect(crossedTickCount(late!.atMs + 40)).toBe(1490);
    expect(crossedTickCount(late!.atMs + 40)).toBeGreaterThan(crossedTickCount(pattern.durationMs));
  });

  it("applies the oracle A-or-B clock, reversible leases, and continuous sine mask", () => {
    const pattern = executablePattern("room.in_between.stable_intersection");
    const kernel = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.stable_intersection"),
      seed: STABLE_INTERSECTION_REPORT_SEED,
    });
    const sampleTicks = new Set([
      82, 87, 97, 98, 106, 111, 144, 145, 192, 193, 239, 240, 288, 289, 670, 671, 672,
    ]);
    const samples = new Map<number, ReturnType<CanonicalCombatKernel["snapshot"]>>();
    for (let tick120 = 1; tick120 <= 672; tick120 += 1) {
      const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      if (sampleTicks.has(tick120)) samples.set(tick120, snapshot);
    }
    const projectileAt = (tick120: number, sourceId: string, sourceIndex: number) => {
      const projectile = samples.get(tick120)?.projectiles.find((entry) =>
        entry.sourceId === sourceId
        && entry.burstIndex === 0
        && entry.sourceIndex === sourceIndex);
      expect(projectile, `${sourceId}/${sourceIndex} at ${tick120}`).toBeDefined();
      return projectile as NonNullable<typeof projectile>;
    };

    const orthogonalArm = projectileAt(87, "orthogonal-a", 0);
    expect(projectileAt(82, "orthogonal-a", 0)).toMatchObject({
      state: "arm",
      collisionEnabled: false,
      position: {x: 29.666666666666664, y: 19.2},
      spawnedAtTick: 82,
      armAtTick: 87,
    });
    // At 725ms both clocks are open. The immutable Python oracle simplifies
    // XOR plus the both-open intersection to A OR B, so this lease is live.
    expect(orthogonalArm).toMatchObject({
      instanceId: "combat:room.in_between.stable_intersection/micro/0000",
      generation: 0,
      state: "flight",
      collisionEnabled: true,
      position: {x: 29.666666666666664, y: 19.2},
      movedAtTick120: null,
    });
    const orthogonalBeforeClose = projectileAt(97, "orthogonal-a", 0);
    const orthogonalClosed = projectileAt(98, "orthogonal-a", 0);
    expect(orthogonalBeforeClose.position.y).toBeCloseTo(30.866666666666678, 12);
    expect(orthogonalClosed).toMatchObject({collisionEnabled: false, speedPxPerSecond: 0});
    expect(orthogonalClosed.position).toEqual(orthogonalBeforeClose.position);
    const orthogonalReopened = projectileAt(192, "orthogonal-a", 0);
    expect(orthogonalReopened).toMatchObject({
      instanceId: orthogonalArm.instanceId,
      generation: orthogonalArm.generation,
      collisionEnabled: true,
      speedPxPerSecond: 0,
    });
    expect(orthogonalReopened.position).toEqual(orthogonalClosed.position);
    expect(projectileAt(193, "orthogonal-a", 0).position.y - orthogonalReopened.position.y)
      .toBeCloseTo(140 / 120, 12);

    expect(projectileAt(106, "diagonal-b", 0)).toMatchObject({
      instanceId: "combat:room.in_between.stable_intersection/micro/0012",
      generation: 0,
      state: "arm",
      collisionEnabled: false,
      position: {x: 32.400000000000006, y: 51.2},
      spawnedAtTick: 106,
      armAtTick: 111,
    });
    expect(projectileAt(111, "diagonal-b", 0)).toMatchObject({
      state: "flight",
      collisionEnabled: false,
      speedPxPerSecond: 0,
      position: {x: 32.400000000000006, y: 51.2},
    });
    const diagonalOpen = projectileAt(144, "diagonal-b", 0);
    expect(diagonalOpen).toMatchObject({collisionEnabled: true, speedPxPerSecond: 0});
    expect(projectileAt(145, "diagonal-b", 0).position).toEqual({
      x: 33.22763665130802,
      y: 52.22402572454151,
    });
    const diagonalBeforeClose = projectileAt(239, "diagonal-b", 0);
    const diagonalClosed = projectileAt(240, "diagonal-b", 0);
    expect(diagonalClosed).toMatchObject({collisionEnabled: false, speedPxPerSecond: 0});
    expect(diagonalClosed.position).toEqual(diagonalBeforeClose.position);
    const diagonalReopened = projectileAt(288, "diagonal-b", 0);
    expect(diagonalReopened).toMatchObject({collisionEnabled: true, speedPxPerSecond: 0});
    expect(diagonalReopened.position).toEqual(diagonalClosed.position);
    expect(projectileAt(289, "diagonal-b", 0).position).toEqual({
      x: 111.85311852556916,
      y: 149.5064695559852,
    });

    const phaseBefore = projectileAt(670, "orthogonal-a", 5);
    const phaseMasked = projectileAt(671, "orthogonal-a", 5);
    expect(phaseBefore).toMatchObject({collisionEnabled: true, speedPxPerSecond: 140});
    expect(phaseBefore.position.y).toBeCloseTo(475.3666666666694, 10);
    expect(phaseMasked).toMatchObject({collisionEnabled: false, speedPxPerSecond: 140});
    expect(phaseMasked.position.y - phaseBefore.position.y).toBeCloseTo(140 / 120, 12);
    expect(projectileAt(672, "orthogonal-a", 5).position.y - phaseMasked.position.y)
      .toBeCloseTo(140 / 120, 12);

    expect(kernel.events()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 98,
        entityStableId: orthogonalArm.instanceId,
        payload: expect.objectContaining({reason: "dual_clock_gate"}),
      }),
      expect.objectContaining({
        id: "projectile.collision.on",
        tick120: 192,
        entityStableId: orthogonalArm.instanceId,
      }),
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 240,
        entityStableId: diagonalOpen.instanceId,
        payload: expect.objectContaining({reason: "dual_clock_gate"}),
      }),
      expect.objectContaining({
        id: "projectile.collision.off",
        tick120: 671,
        entityStableId: phaseBefore.instanceId,
        payload: expect.objectContaining({reason: "phase_gate"}),
      }),
    ]));
    expect(kernel.events().some((event) => event.payload.reason === "source_withdrawn")).toBe(false);
    expect(new Set(kernel.events().map((event) => event.occurrenceKey)).size)
      .toBe(kernel.events().length);
  });

  it("retains every E\/N\/H identity, protects the corridor, and drains exactly", {
    timeout: 40_000,
  }, () => {
    const pattern = executablePattern("room.in_between.stable_intersection");
    const allowedEventIds = new Set([
      "evidence.gain.commit",
      "projectile.arm.begin",
      "projectile.armed",
      "projectile.cancel.commit",
      "projectile.collision.off",
      "projectile.collision.on",
      "projectile.flight.begin",
      "projectile.graze.commit",
      "projectile.lifecycle.complete",
      "projectile.residue.begin",
      "projectile.residue.remove",
      "projectile.spawn.commit",
    ]);
    const expected = {
      EASY: {
        candidates: 223,
        armed: 214,
        on: 775,
        off: 788,
        dualOff: 550,
        phaseOff: 15,
        outOfBounds: 59,
        patternEnd: 164,
        removedAtEnd: 5,
        activeResidue: 218,
        allocated: 219,
        peakLive: 168,
        peakResidue: 218,
        endHash: "0dab165f009b39c96b804efcc6393e0d3dfac8ab32249f5758fc854bf45d0271",
        fullHash: "35c45ab634ddca50cd67b62b3b80e094bef593d05d0493c024f32855c9acaa15",
      },
      NORMAL: {
        candidates: 300,
        armed: 300,
        on: 1095,
        off: 1099,
        dualOff: 776,
        phaseOff: 23,
        outOfBounds: 112,
        patternEnd: 188,
        removedAtEnd: 37,
        activeResidue: 263,
        allocated: 289,
        peakLive: 210,
        peakResidue: 263,
        endHash: "44b29fead5702979827b26c15b8a86258076f01b7ab6941b87d8b639d9bf1a08",
        fullHash: "1509b2cf295b6a56a346cda4eaf2bbcf3f62fd30fd75aa319aa73be66b2f69b4",
      },
      HARD: {
        candidates: 354,
        armed: 354,
        on: 1324,
        off: 1329,
        dualOff: 946,
        phaseOff: 29,
        outOfBounds: 194,
        patternEnd: 160,
        removedAtEnd: 75,
        activeResidue: 279,
        allocated: 352,
        peakLive: 260,
        peakResidue: 279,
        endHash: "07faaeee0e34dc2287876c7af885056b8515f7d5feb4d4db5ebb5bc41e102b84",
        fullHash: "31b8b615cc392fc0c0ceb01a2951137c1c6c629e0ea3c2c886fb6c4cd5c2e840",
      },
    } as const;

    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const facts = expected[difficulty];
      const kernel = new CanonicalCombatKernel({
        ...optionsFor("room.in_between.stable_intersection"),
        seed: STABLE_INTERSECTION_REPORT_SEED,
        difficulty,
      });
      let peakLive = 0;
      let peakResidue = 0;
      let minimumCollisionMargin = Number.POSITIVE_INFINITY;
      for (let tick120 = 1; tick120 <= 1488; tick120 += 1) {
        const snapshot = kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
        peakLive = Math.max(peakLive, snapshot.poolUsage.liveColliders);
        peakResidue = Math.max(peakResidue, snapshot.poolUsage.residueVisuals);
        const corridorCenter = safeGapCenter(pattern, tick120 * 1000 / 120);
        for (const projectile of snapshot.projectiles) {
          if (
            projectile.state !== "flight"
            || !projectile.collisionEnabled
            || projectile.position.y < 476
            || projectile.position.y > 622
          ) continue;
          minimumCollisionMargin = Math.min(
            minimumCollisionMargin,
            Math.abs(projectile.position.x - corridorCenter) - (
              safeGapWidth(pattern, difficulty) / 2
              + projectile.collisionRadiusPx
              + 2
            ),
          );
        }
      }
      const snapshot = kernel.snapshot();
      const events = kernel.events();
      const count = (id: string, reason?: string) => events.filter((event) =>
        event.id === id && (reason === undefined || event.payload.reason === reason)).length;
      expect([...new Set(events.map((event) => event.id))]
        .every((id) => allowedEventIds.has(id))).toBe(true);
      expect(minimumCollisionMargin).toBeGreaterThanOrEqual(-1e-9);
      expect({
        rng: snapshot.rngCallsConsumed,
        spawn: count("projectile.spawn.commit"),
        armBegin: count("projectile.arm.begin"),
        armed: count("projectile.armed"),
        flight: count("projectile.flight.begin"),
        on: count("projectile.collision.on"),
        off: count("projectile.collision.off"),
        dualOff: count("projectile.collision.off", "dual_clock_gate"),
        phaseOff: count("projectile.collision.off", "phase_gate"),
        outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
        patternEnd: count("projectile.cancel.commit", "pattern_end"),
        cancel: count("projectile.cancel.commit"),
        residue: count("projectile.residue.begin"),
        removed: count("projectile.residue.remove"),
        activeResidue: snapshot.projectiles.length,
        allocated: snapshot.poolUsage.allocatedSlots.micro,
        peakLive,
        peakResidue,
        hash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        rng: facts.candidates,
        spawn: facts.candidates,
        armBegin: facts.candidates,
        armed: facts.armed,
        flight: facts.armed,
        on: facts.on,
        off: facts.off,
        dualOff: facts.dualOff,
        phaseOff: facts.phaseOff,
        outOfBounds: facts.outOfBounds,
        patternEnd: facts.patternEnd,
        cancel: facts.candidates,
        residue: facts.candidates,
        removed: facts.removedAtEnd,
        activeResidue: facts.activeResidue,
        allocated: facts.allocated,
        peakLive: facts.peakLive,
        peakResidue: facts.peakResidue,
        hash: facts.endHash,
      });
      expect(snapshot).toMatchObject({
        tick120: 1488,
        relativeTick120: 1488,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
        player: {health: 3},
        evidence: {amount: 0, consumedPurposeCount: 0},
        poolUsage: {liveColliders: 0, residueVisuals: facts.activeResidue},
      });
      expect(snapshot.projectiles.every((projectile) =>
        projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
      expect(kernel.projectilePoolAudit()).toEqual([]);
      expect(events.some((event) =>
        event.id === "projectile.impact.commit"
        || event.id === "player.damage.commit"
        || event.id.startsWith("laser.")
        || event.id.startsWith("boss.")
        || event.id.startsWith("room.")
        || event.id.startsWith("run.")
        || event.payload.reason === "source_withdrawn")).toBe(false);
      expect(events.some((event) =>
        event.tick120 === 1488 && event.id === "projectile.collision.on")).toBe(false);
      expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);

      if (difficulty === "EASY") {
        const late = snapshot.projectiles.filter((projectile) =>
          projectile.sourceId === "orthogonal-a" && projectile.burstIndex === 14);
        expect(late).toHaveLength(9);
        expect(late).toEqual(expect.arrayContaining(Array.from({length: 9}, () =>
          expect.objectContaining({
            state: "residue",
            collisionEnabled: false,
            spawnedAtTick: 1485,
            armAtTick: 1490,
            movedAtTick120: null,
            speedPxPerSecond: 123.2,
            terminalCause: "cancel",
          }))));
        for (const projectile of late) {
          expect(events.some((event) =>
            event.entityStableId === projectile.instanceId
            && event.id === "projectile.collision.on"
            && event.payload.generation === projectile.generation)).toBe(false);
          expect(events.filter((event) =>
            event.tick120 === 1488 && event.entityStableId === projectile.instanceId)
            .map((event) => event.id)).toEqual([
              "projectile.collision.off",
              "projectile.cancel.commit",
              "projectile.residue.begin",
            ]);
        }
      }

      for (let tick120 = 1489; tick120 <= 1866; tick120 += 1) {
        kernel.step(safeGapFollowingInput(kernel, pattern, tick120));
      }
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1866,
        projectileLifecycleDrained: false,
        handoffReady: false,
      });
      expect(kernel.snapshot().projectiles.length).toBeGreaterThan(0);
      kernel.step(safeGapFollowingInput(kernel, pattern, 1867));
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1867,
        projectiles: [],
        poolUsage: {liveColliders: 0, residueVisuals: 0},
        projectileLifecycleDrained: true,
        handoffReady: true,
      });
      expect(kernel.events().filter((event) => event.id === "projectile.residue.remove"))
        .toHaveLength(facts.candidates);
      expect(kernel.events().filter((event) => event.id === "projectile.lifecycle.complete"))
        .toHaveLength(facts.candidates);
      expect(sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())))
        .toBe(facts.fullHash);
    }
  });

  it("keeps clock, sine mask, and event identities relative to a nonzero start tick", () => {
    const pattern = executablePattern("room.in_between.stable_intersection");
    const offsetTick120 = 419;
    const zero = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.stable_intersection"),
      seed: STABLE_INTERSECTION_REPORT_SEED,
    });
    const offset = new CanonicalCombatKernel({
      ...optionsFor("room.in_between.stable_intersection"),
      seed: STABLE_INTERSECTION_REPORT_SEED,
      startTick120: offsetTick120,
    });
    const stepRelative = (kernel: CanonicalCombatKernel, relativeTick120: number) => {
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
      const currentX = kernel.snapshot().playerPosition.x;
      kernel.step({
        tick120: kernel.snapshot().startTick120 + relativeTick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
      });
    };
    for (let relativeTick120 = 1; relativeTick120 <= 1000; relativeTick120 += 1) {
      stepRelative(zero, relativeTick120);
      stepRelative(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((projectile) => ({
        ...projectile,
        spawnedAtTick: projectile.spawnedAtTick - start,
        armAtTick: projectile.armAtTick - start,
        movedAtTick120: projectile.movedAtTick120 === null
          ? null
          : projectile.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);
    expect(offset.snapshot().poolUsage).toEqual(zero.snapshot().poolUsage);
  });

  it("stays trace-identical across cadence, backlog, weather, and accessibility projections", {
    timeout: 40_000,
  }, () => {
    const targetTick120 = 1488;
    const baseline = driveStableIntersectionWithDeltas(
      Array.from({length: 372}, () => 1000 / 30),
      targetTick120,
    );
    const variants = [
      driveStableIntersectionWithDeltas(
        Array.from({length: 744}, () => 1000 / 60),
        targetTick120,
        0,
        {weatherEvent: "sleet", reducedMotion: true, flashOff: true},
      ),
      driveStableIntersectionWithDeltas(
        Array.from({length: 1786}, () => 1000 / 144),
        targetTick120,
        0,
        {weatherEvent: "ash", reducedMotion: false, flashOff: true},
      ),
      driveStableIntersectionWithDeltas(
        [12400],
        targetTick120,
        0,
        {weatherEvent: "clear", reducedMotion: true, flashOff: false},
      ),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});

describe("isolated Ash Memory weather-echo combat capability", () => {
  const patternId = "encounter.weather_echo.ash_memory" as const;
  const pattern = executablePattern(patternId);

  const createAsh = (
    difficulty: "EASY" | "NORMAL" | "HARD" = "NORMAL",
    startTick120 = 0,
    roomId = "INFORMATION",
  ) => new CanonicalCombatKernel({
    ...optionsFor(patternId),
    seed: ASH_MEMORY_REPORT_SEED,
    difficulty,
    startTick120,
    roomId,
  });

  const stepFollowingGap = (kernel: CanonicalCombatKernel, relativeTick120: number): void => {
    const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
    const targetX = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
    const currentX = kernel.snapshot().playerPosition.x;
    kernel.step({
      tick120: kernel.snapshot().startTick120 + relativeTick120,
      movement: {
        x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
        y: 0,
      },
      focused: false,
    });
  };

  const projectile = (
    kernel: CanonicalCombatKernel,
    burstIndex: number,
    sourceIndex: number,
  ) => {
    const value = kernel.snapshot().projectiles.find((entry) =>
      entry.sourceId === "ash-echo"
      && entry.burstIndex === burstIndex
      && entry.sourceIndex === sourceIndex);
    expect(value).toBeDefined();
    return value as NonNullable<typeof value>;
  };

  it("pins the exact weather firewall, serialized reverse path, and V4 QA evidence", () => {
    const kernel = createAsh();
    const contract = kernel.patternContractSnapshot();
    expect(() => validateAshMemoryPatternContract(contract)).not.toThrow();
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract).toMatchObject({
      id: patternId,
      category: "WEATHER_ECHO",
      room: "COMMON",
      durationMs: 10200,
      timeline: [
        {atMs: 0, event: "warning.begin"},
        {atMs: 759, event: "collision.arm"},
        {atMs: 759, event: "emit.begin"},
        {atMs: 5100, event: "pattern.midpoint"},
        {atMs: 9500, event: "emit.end"},
        {atMs: 9780, event: "residue.commit"},
        {atMs: 10200, event: "pattern.complete"},
      ],
      emitters: [expect.objectContaining({
        id: "ash-echo",
        anchor: {space: "viewport-normalized", x: 0.5, y: 0.08},
        geometry: {
          type: "history_chain",
          variant: "reverse-short-trace",
          count: 10,
          baseAngleDeg: 90,
          spreadDeg: 0,
          ordering: "clockwise-then-source-index",
        },
        cadence: {startMs: 759, intervalMs: 1600, bursts: 6, intraBurstMs: 0},
        projectile: {archetype: "bullet.micro.shard", collisionRadiusPx: 2, armDelayMs: 40},
        speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 94}]},
        motionStack: [{
          operator: "op.history_replay",
          params: {
            points: [
              [180, 70, 0],
              [132, 190, 500],
              [214, 330, 1000],
              [166, 470, 1500],
              [196, 600, 1900],
            ],
            delayMs: 420,
            mode: "reverse",
          },
        }],
      })],
      safeGap: {
        type: "ash_wake",
        minimumWidthPx: 44,
        focusMinimumWidthPx: 36,
        enforcement: "operator_constraint",
        path: {centerX: 180, amplitudePx: 38, periodMs: 9200, phase: 0, laneX: []},
      },
      warning: {durationMs: 759, shape: "reverse_trace_preview", coversSweptArea: true},
      residue: {type: "ash_fiber", lifetimeMs: 3194, gameplayCollision: false},
      seed: {
        base: 2725936518,
        disallowedInputs: ["weatherEvent", "weatherSeed", "weatherRng"],
      },
      weatherEchoContract: {
        visualSource: "ASH",
        schedulingAuthority: "director.encounter.v4",
        runsParallelToWeather: true,
        weatherEventCanTrigger: false,
        weatherEventCanSpawnProjectile: false,
        weatherEventCanAlterMotion: false,
        weatherEventCanAlterCollision: false,
        weatherEventCanAlterSafeGap: false,
        weatherRngUsed: false,
        seedAuthority: "pattern.seed only",
      },
    });
    expect("laserGeometry" in contract).toBe(false);
    expect("resolutionHook" in contract).toBe(false);

    expect(patternStructureReportJson.patterns.find((entry) => entry.patternId === patternId))
      .toMatchObject({
        sha256: "992daefaac793bab220f7ce0dc3e88d4a6a6b57aca2eddff20de6e9bff7dcc9d",
        normalized: {
          emitters: [expect.objectContaining({
            geometry: "history_chain",
            operators: ["op.history_replay"],
          })],
        },
      });
    expect(safeGapReportJson.patterns.find((entry) => entry.patternId === patternId))
      .toMatchObject({
        pass: true,
        normal: {
          minimumClearancePx: 21.236,
          pathHash: "e1ae3ac133e2ce0ac88d5855252086a9876e134f04015d164c916a934c9dcab9",
        },
        focus: {
          minimumClearancePx: 22.236,
          pathHash: "e1ae3ac133e2ce0ac88d5855252086a9876e134f04015d164c916a934c9dcab9",
        },
      });

    const expected = {
      EASY: [48, 645, "2dba0f30f4c120aa55bae38e2b6b4db27af081f689b10dc9a0f6050a022518e5"],
      NORMAL: [60, 816, "8e4697fc1035c123adcb197af977c40208d26882ef5de295cc7cf1227d29d5de"],
      HARD: [72, 828, "34f7a1a7f0a9d64fbebbca47207dc6c83ea56601f1783316aa2e5866a0c090b4"],
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const reference = simulatePattern(contract, {
        seed: ASH_MEMORY_REPORT_SEED,
        difficulty,
        semantics: "reference-v4",
      });
      const declared = simulatePattern(contract, {
        seed: ASH_MEMORY_REPORT_SEED,
        difficulty,
        semantics: "declared-v4",
      });
      for (const trace of [reference, declared]) {
        expect({
          bursts: trace.events.length,
          candidates: trace.events.reduce((total, event) => total + event.count, 0),
          redirects: trace.omittedOrRedirected,
          splitChildren: trace.splitChildren,
          hash: trace.traceSha256,
        }).toEqual({
          bursts: 6,
          candidates: expected[difficulty][0],
          redirects: expected[difficulty][1],
          splitChildren: 0,
          hash: expected[difficulty][2],
        });
      }
      expect(declared.traceSha256).toBe(reference.traceSha256);
    }
  });

  it("fails closed on history, weather, descriptor, pool, and admission drift", () => {
    const source = structuredClone(pattern);
    expect(() => validateAshMemoryPatternContract(source)).not.toThrow();
    expect(() => validateHistoryReplayParameters(
      source.emitters[0]!.motionStack[0]!.params,
    )).not.toThrow();

    const extra = structuredClone(source) as unknown as Record<string, unknown>;
    extra.weatherWriteBack = true;
    expect(() => validateAshMemoryPatternContract(extra)).toThrow(/contract drifted/);
    const modeDrift = structuredClone(source);
    (modeDrift.emitters[0]!.motionStack[0]!.params as {mode: string}).mode = "follow";
    expect(() => validateAshMemoryPatternContract(modeDrift)).toThrow(/contract drifted/);
    expect(() => validateHistoryReplayParameters(
      modeDrift.emitters[0]!.motionStack[0]!.params,
    )).toThrow(/mode must be reverse/);
    const pointOrderDrift = structuredClone(source);
    const pointOrder = pointOrderDrift.emitters[0]!.motionStack[0]!.params as unknown as {
      points: number[][];
    };
    pointOrder.points[2]![2] = 500;
    expect(() => validateHistoryReplayParameters(
      pointOrderDrift.emitters[0]!.motionStack[0]!.params,
    )).toThrow(/strictly ordered/);
    const sparsePoints = structuredClone(source);
    const sparse = sparsePoints.emitters[0]!.motionStack[0]!.params as unknown as {
      points: Array<number[] | undefined>;
    };
    delete sparse.points[1];
    expect(() => validateHistoryReplayParameters(
      sparsePoints.emitters[0]!.motionStack[0]!.params,
    )).toThrow(/dense/);

    let accessorReads = 0;
    const accessorParams = Object.defineProperty({
      delayMs: 420,
      points: source.emitters[0]!.motionStack[0]!.params.points,
    }, "mode", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "reverse";
      },
    });
    expect(() => validateHistoryReplayParameters(accessorParams)).toThrow(/own data property/);
    expect(accessorReads).toBe(0);

    expect(() => new CanonicalCombatKernel({
      ...optionsFor(patternId),
      projectilePoolClasses: {"bullet.micro.shard": "medium"},
    })).toThrow(/pool mapping|micro pool class/i);
    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS).not.toContain(patternId);
    const kernel = createAsh();
    expect(kernel.adapterGaps.ashMemoryHistoryReplay).toEqual({
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity",
      spawnOrdinal: "occurrence-local-emitter-burst-source-order-starting-at-one",
      armPolicy: "anchor-spawn-then-first-flight-tick-sweeps-to-reversed-path-head",
      replayClock: "authored-spawn-age-with-delay-held-at-reversed-path-head",
      pathSweep: "absolute-polyline-split-at-authored-vertices",
      crossSideEntry: "safe-prefix-plus-disconnected-snapped-endpoint-no-interior-contact",
      redirectPolicy: "absolute-replay-before-repeatable-operator-constraint",
      releasePolicy: "first-fixed-tick-after-replay-end-continues-at-owned-heading-and-speed",
      weatherAuthority: "withheld-no-weather-event-seed-rng-motion-collision-or-gap-input",
      admission: "isolated-kernel-no-director-session-renderer-or-default-run",
    });
    expect("weatherEvent" in kernel.adapterGaps).toBe(false);
    expect("weatherSeed" in kernel.adapterGaps).toBe(false);
    expect("weatherRng" in kernel.adapterGaps).toBe(false);
  });

  it("keeps exact cadence, anchor sweep, stable uid offsets, reverse interpolation, and release", () => {
    const expectedCadence = {
      EASY: {
        count: 8,
        spawn: [92, 314, 537, 760, 982, 1205],
        arm: [96, 319, 542, 765, 987, 1210],
      },
      NORMAL: {
        count: 10,
        spawn: [92, 284, 476, 668, 860, 1052],
        arm: [96, 288, 480, 672, 864, 1056],
      },
      HARD: {
        count: 12,
        spawn: [92, 261, 429, 598, 767, 936],
        arm: [96, 265, 434, 603, 772, 941],
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const schedule = createPatternSchedule(pattern, difficulty);
      expect(schedule).toHaveLength(6);
      expect(roundPatternCount(
        pattern.emitters[0]!.geometry.count * pattern.difficulty[difficulty].countMultiplier,
      )).toBe(expectedCadence[difficulty].count);
      expect(schedule.map((entry) => crossedTickCount(entry.atMs)))
        .toEqual(expectedCadence[difficulty].spawn);
      expect(schedule.map((entry) => crossedTickCount(
        entry.atMs + entry.emitter.projectile.armDelayMs,
      ))).toEqual(expectedCadence[difficulty].arm);
    }

    const kernel = createAsh();
    for (let tick120 = 1; tick120 <= 92; tick120 += 1) {
      stepFollowingGap(kernel, tick120);
    }
    expect(kernel.snapshot().rngCallsConsumed).toBe(10);
    expect(projectile(kernel, 0, 0)).toMatchObject({
      state: "arm",
      position: {x: 162, y: 51.2},
      spawnedAtTick: 92,
      armAtTick: 96,
      collisionEnabled: false,
    });
    for (let tick120 = 93; tick120 <= 96; tick120 += 1) {
      stepFollowingGap(kernel, tick120);
    }
    expect(projectile(kernel, 0, 0)).toMatchObject({
      state: "flight",
      position: {x: 162, y: 51.2},
      collisionEnabled: true,
    });
    stepFollowingGap(kernel, 97);
    const firstCenter = safeGapCenter(pattern, 97 * 1000 / 120);
    expect(projectile(kernel, 0, 0)).toMatchObject({
      previousPosition: {x: 162, y: 51.2},
      position: {x: firstCenter - 26, y: 600},
      headingDegrees: 82,
      speedPxPerSecond: 94,
    });
    expect(projectile(kernel, 0, 4)).toMatchObject({
      previousPosition: {x: 178, y: 39.2},
      position: {x: firstCenter + 26, y: 600},
      headingDegrees: 98,
    });

    const reversed = [
      [196, 600, 0],
      [166, 470, 400],
      [214, 330, 900],
      [132, 190, 1400],
      [180, 70, 1900],
    ] as const;
    const replayPosition = (tick120: number, ordinal: number) => {
      const localMs = tick120 * 1000 / 120 - 759 - 420;
      const offset = ((ordinal % 7) - 3) * 2.2;
      for (let index = 0; index < reversed.length - 1; index += 1) {
        const left = reversed[index]!;
        const right = reversed[index + 1]!;
        if (localMs > right[2]) continue;
        const progress = (localMs - left[2]) / (right[2] - left[2]);
        return {
          x: left[0] + (right[0] - left[0]) * progress + offset,
          y: left[1] + (right[1] - left[1]) * progress,
        };
      }
      throw new Error("test replay sample exceeded the authored path");
    };
    for (const tick120 of [191, 250, 310, 369] as const) {
      for (let next = kernel.snapshot().tick120 + 1; next <= tick120; next += 1) {
        stepFollowingGap(kernel, next);
      }
      expect(projectile(kernel, 0, 0).position.x).toBeCloseTo(replayPosition(tick120, 1).x, 10);
      expect(projectile(kernel, 0, 0).position.y).toBeCloseTo(replayPosition(tick120, 1).y, 10);
    }
    expect(projectile(kernel, 0, 6).position.x - projectile(kernel, 0, 0).position.x)
      .toBeCloseTo(-2.2, 10);
    expect(projectile(kernel, 0, 7).position.x).toBeCloseTo(projectile(kernel, 0, 0).position.x, 10);

    const beforeRelease = projectile(kernel, 0, 0);
    stepFollowingGap(kernel, 370);
    const afterRelease = projectile(kernel, 0, 0);
    const radians = beforeRelease.headingDegrees * Math.PI / 180;
    expect(afterRelease.headingDegrees).toBe(beforeRelease.headingDegrees);
    expect(afterRelease.position.x).toBeCloseTo(
      beforeRelease.position.x + Math.cos(radians) * 94 / 120,
      10,
    );
    expect(afterRelease.position.y).toBeCloseTo(
      beforeRelease.position.y + Math.sin(radians) * 94 / 120,
      10,
    );
  });

  it("uses the first anchor-to-path capsule for contact and component-safe Override paths", () => {
    const contact = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: ASH_MEMORY_REPORT_SEED,
      initialPlayerPosition: {x: 180, y: 385},
    });
    for (let tick120 = 1; tick120 <= 97; tick120 += 1) {
      contact.step({...inputAt(tick120), focused: false});
    }
    expect(contact.events().filter((event) => event.id === "player.damage.commit"))
      .toEqual([expect.objectContaining({tick120: 97})]);
    expect(contact.events().filter((event) => event.id === "projectile.impact.commit"))
      .toEqual([expect.objectContaining({tick120: 97})]);

    const overridden = new CanonicalCombatKernel({
      ...optionsFor(patternId),
      seed: ASH_MEMORY_REPORT_SEED,
      grazeRadiusPx: 1000,
    });
    for (let tick120 = 1; tick120 <= 170; tick120 += 1) {
      const maximumTravel = PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120;
      const targetX = safeGapCenter(pattern, tick120 * 1000 / 120);
      const currentX = overridden.snapshot().playerPosition.x;
      overridden.step({
        tick120,
        movement: {
          x: Math.max(-1, Math.min(1, (targetX - currentX) / maximumTravel)),
          y: 0,
        },
        focused: false,
        ...(tick120 === 30
          ? {overridePressed: true, overrideDirection: {x: 0, y: -1}}
          : {}),
      });
    }
    expect(overridden.snapshot().override).toMatchObject({state: "active", cycle: 1});
    const overrideCancels = overridden.events().filter((event) =>
      event.id === "projectile.cancel.commit" && event.payload.reason === "override_void");
    expect(overrideCancels).toHaveLength(10);
    expect(overrideCancels.map((event) => event.tick120)).toEqual([
      156, 156, 156, 156, 156, 156, 156, 156, 156, 160,
    ]);
    expect(overridden.events().filter((event) => event.id === "player.damage.commit")).toEqual([]);
  });

  it("preserves every candidate and drains collisionless Ash residue across E/N/H", {
    timeout: 20_000,
  }, () => {
    const expected = {
      EASY: {
        candidates: 48,
        outOfBounds: 15,
        patternEnd: 33,
        residuesAtComplete: 41,
        productionHash: "cee50f5cdda53dd8c266896a46c3560a3333d9fdad100ea5d28b897bab23da2b",
      },
      NORMAL: {
        candidates: 60,
        outOfBounds: 25,
        patternEnd: 35,
        residuesAtComplete: 49,
        productionHash: "4d9b92572e8f00e43a904826e47829730fa8630ea0e9d06e09725b444b8b168b",
      },
      HARD: {
        candidates: 72,
        outOfBounds: 33,
        patternEnd: 39,
        residuesAtComplete: 60,
        productionHash: "553bab131d5b215aa5217440b8333f53114854388722ee7814a94e8f454cc055",
      },
    } as const;
    for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
      const kernel = createAsh(difficulty);
      for (let relativeTick120 = 1; relativeTick120 <= 1224; relativeTick120 += 1) {
        stepFollowingGap(kernel, relativeTick120);
        const snapshot = kernel.snapshot();
        const center = safeGapCenter(pattern, relativeTick120 * 1000 / 120);
        for (const body of snapshot.projectiles) {
          if (
            body.state === "flight"
            && body.collisionEnabled
            && body.position.y >= 476
            && body.position.y <= 622
          ) {
            expect(Math.abs(body.position.x - center)).toBeGreaterThanOrEqual(
              safeGapWidth(pattern, difficulty) / 2 + body.collisionRadiusPx + 2 - 1e-9,
            );
          }
        }
      }
      const events = kernel.events();
      const countCancel = (reason: string) => events.filter((event) =>
        event.id === "projectile.cancel.commit" && event.payload.reason === reason).length;
      expect({
        rng: kernel.snapshot().rngCallsConsumed,
        spawn: events.filter((event) => event.id === "projectile.spawn.commit").length,
        outOfBounds: countCancel("out_of_bounds"),
        patternEnd: countCancel("pattern_end"),
        sourceWithdrawn: countCancel("source_withdrawn"),
        impact: events.filter((event) => event.id === "projectile.impact.commit").length,
        damage: events.filter((event) => event.id === "player.damage.commit").length,
        residuesAtComplete: kernel.snapshot().projectiles.length,
        productionHash: sha256(new TextEncoder().encode(kernel.canonicalEventSerialization())),
      }).toEqual({
        rng: expected[difficulty].candidates,
        spawn: expected[difficulty].candidates,
        outOfBounds: expected[difficulty].outOfBounds,
        patternEnd: expected[difficulty].patternEnd,
        sourceWithdrawn: 0,
        impact: 0,
        damage: 0,
        residuesAtComplete: expected[difficulty].residuesAtComplete,
        productionHash: expected[difficulty].productionHash,
      });
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1224,
        patternComplete: true,
        digitalBodiesDrained: true,
        materialResidueDraining: true,
        projectileLifecycleDrained: false,
        handoffReady: false,
        poolUsage: {liveColliders: 0},
      });
      expect(kernel.snapshot().projectiles.every((body) =>
        body.state === "residue" && !body.collisionEnabled)).toBe(true);

      for (let relativeTick120 = 1225; relativeTick120 <= 1608; relativeTick120 += 1) {
        stepFollowingGap(kernel, relativeTick120);
      }
      expect(kernel.snapshot()).toMatchObject({
        tick120: 1608,
        projectiles: [],
        projectileLifecycleDrained: true,
        handoffReady: true,
        poolUsage: {liveColliders: 0, residueVisuals: 0},
      });
    }
  });

  it("keeps history, identity, cadence, and backlog stable while presentation has no input port", {
    timeout: 20_000,
  }, () => {
    const offsetTick120 = 419;
    const zero = createAsh("NORMAL", 0, "INFORMATION");
    const offset = createAsh("NORMAL", offsetTick120, "POLARIZED");
    for (let relativeTick120 = 1; relativeTick120 <= 500; relativeTick120 += 1) {
      stepFollowingGap(zero, relativeTick120);
      stepFollowingGap(offset, relativeTick120);
    }
    const normalizedProjectiles = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      return kernel.snapshot().projectiles.map((body) => ({
        ...body,
        spawnedAtTick: body.spawnedAtTick - start,
        armAtTick: body.armAtTick - start,
        movedAtTick120: body.movedAtTick120 === null ? null : body.movedAtTick120 - start,
      }));
    };
    const normalizedEvents = (kernel: CanonicalCombatKernel) => {
      const start = kernel.snapshot().startTick120;
      const startMs = start * 1000 / 120;
      const relativeMs = (value: number) =>
        Math.round((value - startMs) * 1_000_000_000) / 1_000_000_000;
      return kernel.events().map((event) => {
        const payload = {...event.payload} as Record<string, unknown>;
        for (const key of ["commitAtMs", "readyAtMs", "removeAtMs"] as const) {
          if (typeof payload[key] === "number") payload[key] = relativeMs(payload[key]);
        }
        return {
          ...event,
          tick120: event.tick120 - start,
          simulationTimeMs: relativeMs(event.simulationTimeMs),
          payload,
        };
      });
    };
    expect(normalizedProjectiles(offset)).toEqual(normalizedProjectiles(zero));
    expect(normalizedEvents(offset)).toEqual(normalizedEvents(zero));
    expect(offset.snapshot().rngCallsConsumed).toBe(zero.snapshot().rngCallsConsumed);
    expect(offset.snapshot().playerPosition).toEqual(zero.snapshot().playerPosition);

    const drive = (
      deltas: readonly number[],
      profile: Readonly<{weather: string; reducedMotion: boolean; flashOff: boolean}>,
    ) => {
      expect(profile.weather.length).toBeGreaterThan(0);
      const kernel = createAsh();
      const clock = new AuthorityClock({
        onTick120: ({tick120}) => stepFollowingGap(kernel, tick120),
      });
      for (const delta of deltas) clock.advance(delta);
      while (clock.snapshot().backlogTicks > 0) clock.advance(0);
      expect(clock.snapshot().tick120).toBe(500);
      return kernel;
    };
    const baseline = drive(
      Array.from({length: 125}, () => 1000 / 30),
      {weather: "ASH", reducedMotion: false, flashOff: false},
    );
    const variants = [
      drive(
        Array.from({length: 250}, () => 1000 / 60),
        {weather: "RAIN", reducedMotion: true, flashOff: true},
      ),
      drive(
        Array.from({length: 600}, () => 1000 / 144),
        {weather: "CLEAR", reducedMotion: false, flashOff: true},
      ),
      drive([500 * 1000 / 120], {weather: "WIND", reducedMotion: true, flashOff: false}),
    ];
    for (const candidate of variants) {
      expect(candidate.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(candidate.snapshot()).toEqual(baseline.snapshot());
    }
  });
});
