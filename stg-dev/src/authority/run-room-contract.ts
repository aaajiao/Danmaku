import encounterDirectorJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/encounter-director-v4.json";
import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import runDirectorJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/run-director-v4.json";
import narrativeStateMachineJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/narrative-state-machine-v4.json";

import {crossedTickCount} from "./tick120";

export const ROOM_ID = "FORCED_ALIGNMENT" as const;
export const COMPOSER_ID = "composer.forced_alignment" as const;
export const TIER_ID = "listen" as const;
export const DIFFICULTY = "EASY" as const;
export const PATTERN_ID = "room.forced.left_right_gate" as const;
export const OCCURRENCE_ID = "room:0:encounter:0:room.forced.left_right_gate" as const;
export const PATTERN_SEED_BASE = 0x6a42_7389;
export const DIFFICULTY_SALT = 0x1100;
export const RESIDUE_LIFETIME_MS = 2631;
export const LISTEN_MAX_PROJECTILES = 80;
export const LISTEN_MAX_EMITTERS = 2;
export const EASY_DIRECTOR_MAX_PROJECTILES = 120;

export const SERIAL_SEGMENTS_MS = Object.freeze({
  telegraph: 520,
  entry: 800,
  read: 10_200,
  materialSettle: 1050,
  rest: 1600,
  safeGapHandoff: 520,
});

export const RELATIVE_BOUNDARY_TICKS120 = Object.freeze({
  handoff: 0,
  telegraph: crossedTickCount(SERIAL_SEGMENTS_MS.telegraph),
  read: crossedTickCount(SERIAL_SEGMENTS_MS.telegraph + SERIAL_SEGMENTS_MS.entry),
  materialSettle: crossedTickCount(
    SERIAL_SEGMENTS_MS.telegraph
      + SERIAL_SEGMENTS_MS.entry
      + SERIAL_SEGMENTS_MS.read,
  ),
  rest: crossedTickCount(
    SERIAL_SEGMENTS_MS.telegraph
      + SERIAL_SEGMENTS_MS.entry
      + SERIAL_SEGMENTS_MS.read
      + SERIAL_SEGMENTS_MS.materialSettle,
  ),
  residueDrained: crossedTickCount(
    SERIAL_SEGMENTS_MS.telegraph
      + SERIAL_SEGMENTS_MS.entry
      + SERIAL_SEGMENTS_MS.read
      + RESIDUE_LIFETIME_MS,
  ),
  fixedSliceComplete: crossedTickCount(
    SERIAL_SEGMENTS_MS.telegraph
      + SERIAL_SEGMENTS_MS.entry
      + SERIAL_SEGMENTS_MS.read
      + SERIAL_SEGMENTS_MS.materialSettle
      + SERIAL_SEGMENTS_MS.rest,
  ),
});

export const FIRST_FIXED_ROOM_CLOSURE_RELATIVE_TICK120 =
  RELATIVE_BOUNDARY_TICKS120.fixedSliceComplete + 1;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function assertFixedBootstrapSource(): void {
  const patterns = executablePatternsJson.patterns.filter((entry) => entry.id === PATTERN_ID);
  const pattern = patterns[0];
  if (
    patterns.length !== 1
    || pattern === undefined
    || pattern.category !== "ROOM"
    || pattern.room !== ROOM_ID
    || pattern.durationMs !== SERIAL_SEGMENTS_MS.read
    || pattern.seed.algorithm !== "mulberry32-v1"
    || pattern.seed.base !== PATTERN_SEED_BASE
    || pattern.seed.composition
      !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || pattern.seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || pattern.emitters.length !== LISTEN_MAX_EMITTERS
    || pattern.safeGap.readability.leadMs !== SERIAL_SEGMENTS_MS.safeGapHandoff
    || pattern.residue.type !== "seam_filament"
    || pattern.residue.lifetimeMs !== RESIDUE_LIFETIME_MS
    || pattern.residue.gameplayCollision !== false
    || pattern.accessibility.reducedMotionGameplayParity !== true
    || pattern.accessibility.flashOffGameplayParity !== true
  ) {
    throw new Error("EXT-2026-005 executable pattern source drifted");
  }

  const composers = roomComposersJson.composers.filter((entry) => entry.id === COMPOSER_ID);
  const composer = composers[0];
  const memberships = composer?.patternPool.filter((entry) => entry.patternId === PATTERN_ID) ?? [];
  const listenTiers = composer?.intensityTiers.filter((entry) => entry.id === TIER_ID) ?? [];
  const listen = listenTiers[0];
  if (
    composers.length !== 1
    || composer === undefined
    || composer.room !== ROOM_ID
    || memberships.length !== 1
    || listenTiers.length !== 1
    || listen === undefined
    || listen.difficulty !== DIFFICULTY
    || listen.budget.maxProjectiles !== LISTEN_MAX_PROJECTILES
    || listen.budget.maxEmitters !== LISTEN_MAX_EMITTERS
    || listen.budget.restMs !== SERIAL_SEGMENTS_MS.rest
    || composer.constraints.safeGapMustOverlapPreviousForMs
      !== SERIAL_SEGMENTS_MS.safeGapHandoff
    || composer.constraints.restWindowCannotBeRemovedByDifficulty !== true
    || composer.materialLedger.roomSpecificResidue !== "seam_filament"
  ) {
    throw new Error("EXT-2026-005 Forced Alignment composer source drifted");
  }

  const segment = (id: string) => encounterDirectorJson.segments.filter((entry) => entry.id === id);
  const telegraph = segment("telegraph");
  const entry = segment("entry");
  const read = segment("read");
  const materialSettle = segment("material_settle");
  const rest = segment("rest");
  const inRange = (value: number, range: readonly number[]): boolean =>
    range.length === 2 && range[0] !== undefined && range[1] !== undefined
      && value >= range[0] && value <= range[1];
  if (
    telegraph.length !== 1
    || !inRange(SERIAL_SEGMENTS_MS.telegraph, telegraph[0]?.durationMs ?? [])
    || telegraph[0]?.collision !== false
    || entry.length !== 1
    || !inRange(SERIAL_SEGMENTS_MS.entry, entry[0]?.durationMs ?? [])
    || read.length !== 1
    || !inRange(SERIAL_SEGMENTS_MS.read, read[0]?.durationMs ?? [])
    || read[0]?.patternSlots?.length !== 2
    || read[0]?.patternSlots?.[0] !== 1
    || read[0]?.patternSlots?.[1] !== 3
    || materialSettle.length !== 1
    || !inRange(SERIAL_SEGMENTS_MS.materialSettle, materialSettle[0]?.durationMs ?? [])
    || materialSettle[0]?.newSpawns !== false
    || rest.length !== 1
    || !inRange(SERIAL_SEGMENTS_MS.rest, rest[0]?.durationMs ?? [])
    || rest[0]?.newSpawns !== false
    || rest[0]?.required !== true
    || encounterDirectorJson.scheduling.safeGapHandoffMs
      !== SERIAL_SEGMENTS_MS.safeGapHandoff
    || encounterDirectorJson.scheduling.enemyPatternStartsOnlyAfterTelegraph !== true
    || encounterDirectorJson.scheduling.crossedFrameEventsExactlyOnce !== true
    || encounterDirectorJson.scheduling.maxProjectileBudget.EASY
      !== EASY_DIRECTOR_MAX_PROJECTILES
  ) {
    throw new Error("EXT-2026-005 encounter director source drifted");
  }

  if (
    runDirectorJson.roomSampling.rooms.filter((room) => room === ROOM_ID).length !== 1
    || runDirectorJson.roomSampling.algorithm !== "weighted_without_replacement"
    || runDirectorJson.roomSampling.neverTreatAsProgression !== true
    || narrativeStateMachineJson.states.FIRST_CLAMP_RECOVERY.next !== "ROOM_SAMPLING"
    || narrativeStateMachineJson.states.ROOM_SAMPLING.inputPolicy !== "full"
  ) {
    throw new Error("EXT-2026-005 Run/narrative source boundary drifted");
  }

  if (
    RELATIVE_BOUNDARY_TICKS120.telegraph !== 63
    || RELATIVE_BOUNDARY_TICKS120.read !== 159
    || RELATIVE_BOUNDARY_TICKS120.materialSettle !== 1383
    || RELATIVE_BOUNDARY_TICKS120.rest !== 1509
    || RELATIVE_BOUNDARY_TICKS120.residueDrained !== 1699
    || RELATIVE_BOUNDARY_TICKS120.fixedSliceComplete !== 1701
    || FIRST_FIXED_ROOM_CLOSURE_RELATIVE_TICK120 !== 1702
  ) {
    throw new Error("EXT-2026-005 cumulative tick projection drifted");
  }
}

assertFixedBootstrapSource();

export const RUN_ROOM_SESSION_CONTRACT = deepFreeze({
  schemaVersion: "1.0.0-ext-2026-005-first-forced-room-bootstrap" as const,
  authority: "fixed-non-composer-first-room-bootstrap" as const,
  extensionPolicy: "EXT-2026-005" as const,
  roomId: ROOM_ID,
  composerId: COMPOSER_ID,
  tierId: TIER_ID,
  difficulty: DIFFICULTY,
  patternId: PATTERN_ID,
  occurrenceId: OCCURRENCE_ID,
  roomOrdinal: 0 as const,
  encounterOrdinal: 0 as const,
  composer: false as const,
  weightedSelection: false as const,
  selectionAuthority: "ext-005-fixed-first-room-bootstrap" as const,
  selectionRngDraws: 0 as const,
  parallel: false as const,
  roomTransition: "direct-install-without-canonical-room-enter-event" as const,
  difficultySalt: DIFFICULTY_SALT,
  resolvedSeedComposition:
    "rawRunSeed xor pattern.base xor encounterOrdinal(0) xor difficultySalt(0x1100)" as const,
  constructorOwnership: "lock-handoff-without-consuming-H-or-flushing" as const,
  firstConsumedTick: "H+1" as const,
  patternLocalTickZero: "H+159-after-shared-idle-flush" as const,
  overrideAvailability: "withheld-until-local-resistance-authority" as const,
  canonicalSegmentEvents: false as const,
  roomComplete: false as const,
  handoffReady: false as const,
  serialSegmentsMs: SERIAL_SEGMENTS_MS,
  relativeBoundaryTicks120: RELATIVE_BOUNDARY_TICKS120,
  budgetEvidence: {
    interpretation: "observational-fixed-slice" as const,
    activeArmOrFlightPeak: 56 as const,
    listenMaxProjectiles: LISTEN_MAX_PROJECTILES,
    easyDirectorMaxProjectiles: EASY_DIRECTOR_MAX_PROJECTILES,
    allAuthorityEntitiesPeak: 77 as const,
  },
});

export const FIRST_FIXED_ROOM_CLOSURE_CONTRACT = deepFreeze({
  schemaVersion: "1.0.0-ext-2026-009-first-fixed-room-closure" as const,
  authority: "single-occurrence-fixed-bootstrap-room-closure" as const,
  extensionPolicy: "EXT-2026-009" as const,
  roomId: ROOM_ID,
  roomOrdinal: 0 as const,
  plannedOccurrenceCount: 1 as const,
  completedOccurrenceCount: 1 as const,
  remainingOccurrenceCount: 0 as const,
  closureRelativeTick120: FIRST_FIXED_ROOM_CLOSURE_RELATIVE_TICK120,
  roomComplete: true as const,
  handoffReady: false as const,
  selectionRngDraws: 0 as const,
  canonicalEventWrites: 0 as const,
  parentCanonicalEventIds: Object.freeze([
    "flower.intensity.commit",
    "gaze.acquire.begin",
    "gaze.acquire.cancel",
    "gaze.clamp.commit",
    "gaze.release.begin",
    "gaze.release.cancel",
    "gaze.clamp.release",
  ] as const),
  metricProjection: false as const,
  selectionAllowed: false as const,
  transitionAllowed: false as const,
  targetRoom: null,
});
