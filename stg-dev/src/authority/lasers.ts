import laserManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/laser-geometries-v4.json";
import {MASTER_TICK_HZ} from "./clock";
import {
  CanonicalEventBus,
  simulationTimeMsForTick,
  type CanonicalGameplayEvent,
  type ReadonlyFeedbackSink,
} from "./events";

export const LASER_TICK_HZ = MASTER_TICK_HZ;
export const LASER_VIEW_WIDTH = 360 as const;
export const LASER_VIEW_HEIGHT = 640 as const;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

interface LaserTiming {
  readonly telegraph: number;
  readonly charge: number;
  readonly grow: number;
  readonly live: number;
  readonly shutdown: number;
  readonly residue: number;
}

export interface LaserDefinition {
  readonly id: string;
  readonly bossId: string;
  readonly geometry: {
    readonly type: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly coordinateSpace: string;
  };
  readonly lifecycle: {
    readonly timingMs: LaserTiming;
    readonly collisionEnable: string;
    readonly collisionDisable: string;
    readonly largeDeltaDispatch: string;
  };
  readonly collision: {
    readonly primitive: string;
    readonly sampleTolerancePx: number;
    readonly authority: string;
    readonly visualAlphaIgnored: boolean;
  };
  readonly warning: {
    readonly geometry: string;
    readonly leadMs: number;
    readonly coversGrowth: boolean;
    readonly flashIndependent: boolean;
  };
  readonly safeOpening: {
    readonly type: string;
    readonly minimumWidthPx: number;
    readonly includedInWarning: boolean;
  };
  readonly cancel: {
    readonly collisionOffBeforeVisual: boolean;
    readonly toResidue: string;
  };
}

interface LaserManifest {
  readonly schemaVersion: string;
  readonly lasers: readonly LaserDefinition[];
}

const laserManifest = laserManifestJson as unknown as LaserManifest;

function deepFreeze(value: unknown, visited = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, visited);
  Object.freeze(value);
}

deepFreeze(laserManifest);

/** The manifest remains the sole topology catalog. */
export const LASER_MANIFEST = laserManifest;
export const LASER_DEFINITIONS = Object.freeze([...laserManifest.lasers]);
const LASER_BY_ID: ReadonlyMap<string, LaserDefinition> = new Map(
  LASER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function laserDefinition(id: string): LaserDefinition {
  const definition = LASER_BY_ID.get(id);
  if (!definition) throw new Error(`unknown V4 laser id: ${id}`);
  validateLaserDefinition(definition);
  return definition;
}

export function millisecondsToAuthorityTicks(milliseconds: number): number {
  assertFiniteNonNegative(milliseconds, "milliseconds");
  return Math.ceil(milliseconds * LASER_TICK_HZ / 1000 - Number.EPSILON);
}

function assertTick(tick120: number, label: string): void {
  if (!Number.isSafeInteger(tick120) || tick120 < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
}

function validateLaserDefinition(definition: LaserDefinition): void {
  if (!definition.id) throw new Error("laser id is required");
  if (!definition.bossId) throw new Error(`laser ${definition.id} bossId is required`);
  if (!definition.geometry?.type) throw new Error(`laser ${definition.id} topology is required`);
  if (definition.geometry.coordinateSpace !== "viewport-normalized-plus-logical-px") {
    throw new Error(`laser ${definition.id} has unsupported coordinate space`);
  }
  if (definition.collision.authority !== "gameplay" || !definition.collision.visualAlphaIgnored) {
    throw new Error(`laser ${definition.id} collision must remain gameplay-authoritative`);
  }
  assertFiniteNonNegative(definition.collision.sampleTolerancePx, `${definition.id} sample tolerance`);
  if (definition.warning.geometry !== "exact_swept_union"
    || !definition.warning.coversGrowth
    || !definition.safeOpening.includedInWarning) {
    throw new Error(`laser ${definition.id} warning does not cover authoritative swept geometry`);
  }
  if (definition.warning.leadMs !== definition.lifecycle.timingMs.telegraph) {
    throw new Error(`laser ${definition.id} warning lead must equal its telegraph duration`);
  }
  if (definition.lifecycle.collisionEnable !== "live.enter"
    || definition.lifecycle.collisionDisable !== "shutdown.enter"
    || definition.lifecycle.largeDeltaDispatch !== "all-crossed-events-once") {
    throw new Error(`laser ${definition.id} has an unsupported lifecycle dispatch contract`);
  }
  if (!definition.cancel.collisionOffBeforeVisual) {
    throw new Error(`laser ${definition.id} cancel must disable collision before presentation`);
  }
  for (const [key, value] of Object.entries(definition.lifecycle.timingMs)) {
    assertFiniteNonNegative(value, `${definition.id} lifecycle.${key}`);
  }
}

function requireNumber(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  topology: string,
): number {
  const value = parameters[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${topology}.${key} must be a finite number`);
  }
  return value;
}

function requireInteger(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  topology: string,
): number {
  const value = requireNumber(parameters, key, topology);
  if (!Number.isSafeInteger(value)) throw new Error(`${topology}.${key} must be an integer`);
  return value;
}

function requireNumberArray(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  topology: string,
): readonly number[] {
  const value = parameters[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`${topology}.${key} must be an array of finite numbers`);
  }
  return value as number[];
}

function requirePoint(value: unknown, path: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2
    || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`${path} must be [x,y]`);
  }
  return [value[0] as number, value[1] as number];
}

function requirePointParameter(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  topology: string,
): readonly [number, number] {
  return requirePoint(parameters[key], `${topology}.${key}`);
}

function requirePoints(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
  topology: string,
): readonly (readonly [number, number])[] {
  const value = parameters[key];
  if (!Array.isArray(value)) throw new Error(`${topology}.${key} must be an array of points`);
  return value.map((point, index) => requirePoint(point, `${topology}.${key}[${index}]`));
}

function viewportPoint(point: readonly [number, number]): Vec2 {
  return Object.freeze({x: point[0] * LASER_VIEW_WIDTH, y: point[1] * LASER_VIEW_HEIGHT});
}

function point(x: number, y: number): Vec2 {
  return Object.freeze({x, y});
}

export interface CapsuleSegment {
  readonly kind: "capsule";
  readonly stableId: string;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly radius: number;
}

export interface AnnularSector {
  readonly kind: "annular-sector-minus-wedge";
  readonly stableId: string;
  readonly origin: Vec2;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startDeg: number;
  readonly endDeg: number;
  readonly missingStartDeg: number;
  readonly missingEndDeg: number;
}

export interface LaserGeometrySnapshot {
  readonly laserId: string;
  readonly topology: string;
  readonly tick120: number;
  readonly activeElapsedTicks: number;
  readonly capsules: readonly CapsuleSegment[];
  readonly sectors: readonly AnnularSector[];
}

export interface LaserGeometryContext {
  readonly tick120: number;
  readonly activeStartTick120?: number;
  readonly activeDurationTicks?: number;
}

function capsule(
  stableId: string,
  from: Vec2,
  to: Vec2,
  radius: number,
): CapsuleSegment {
  assertFiniteNonNegative(radius, `${stableId} radius`);
  return Object.freeze({kind: "capsule", stableId, from, to, radius});
}

function activeGeometryProgress(
  tick120: number,
  activeStartTick120: number,
  activeDurationTicks: number,
): number {
  return activeDurationTicks <= 0
    ? 1
    : Math.max(0, Math.min(1, (tick120 - activeStartTick120) / activeDurationTicks));
}

function defaultBeamRadius(definition: LaserDefinition): number {
  // V4 omits an authored width for broken_polyline and scrolling_comb.
  // The declared collision sampling tolerance is the only gameplay-scale fact.
  return Math.max(0.5, definition.collision.sampleTolerancePx);
}

export function compileLaserGeometry(
  definitionOrId: LaserDefinition | string,
  context: LaserGeometryContext,
): LaserGeometrySnapshot {
  const definition = typeof definitionOrId === "string"
    ? laserDefinition(definitionOrId)
    : definitionOrId;
  validateLaserDefinition(definition);
  assertTick(context.tick120, "laser geometry tick120");
  const activeStartTick120 = context.activeStartTick120 ?? 0;
  assertTick(activeStartTick120, "laser active start tick120");
  const defaultDuration = millisecondsToAuthorityTicks(definition.lifecycle.timingMs.live);
  const activeDurationTicks = context.activeDurationTicks ?? defaultDuration;
  assertTick(activeDurationTicks, "laser active duration ticks");
  const activeElapsedTicks = Math.max(0, context.tick120 - activeStartTick120);
  const progress = activeGeometryProgress(context.tick120, activeStartTick120, activeDurationTicks);
  const elapsedSeconds = activeElapsedTicks / LASER_TICK_HZ;
  const parameters = definition.geometry.parameters;
  const topology = definition.geometry.type;
  const capsules: CapsuleSegment[] = [];
  const sectors: AnnularSector[] = [];

  switch (topology) {
    case "broken_polyline": {
      const points = requirePoints(parameters, "points", topology).map(viewportPoint);
      if (points.length < 2) throw new Error(`${topology}.points requires at least two points`);
      const missing = requireInteger(parameters, "missingSegment", topology);
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        if (index !== missing && from && to) {
          capsules.push(capsule(`segment:${index}`, from, to, defaultBeamRadius(definition)));
        }
      }
      break;
    }
    case "scrolling_comb": {
      const spinePoints = requirePoints(parameters, "spine", topology);
      if (spinePoints.length !== 2) throw new Error(`${topology}.spine requires exactly two points`);
      const from = viewportPoint(spinePoints[0] ?? [0, 0]);
      const to = viewportPoint(spinePoints[1] ?? [0, 1]);
      const radius = defaultBeamRadius(definition);
      capsules.push(capsule("spine", from, to, radius));
      const teeth = requireInteger(parameters, "teeth", topology);
      if (teeth <= 0) throw new Error(`${topology}.teeth must be positive`);
      const length = requireNumber(parameters, "toothLengthPx", topology);
      const scroll = requireNumber(parameters, "scrollPxPerSec", topology) * elapsedSeconds;
      for (let index = 0; index < teeth; index += 1) {
        const y = modulo((index + 0.5) / teeth * LASER_VIEW_HEIGHT + scroll, LASER_VIEW_HEIGHT);
        capsules.push(capsule(`tooth:${index}`, point(from.x, y), point(from.x + length, y), radius));
      }
      break;
    }
    case "half_plane_sweep": {
      const pivot = viewportPoint(requirePointParameter(parameters, "pivot", topology));
      const start = requireNumber(parameters, "startDeg", topology);
      const end = requireNumber(parameters, "endDeg", topology);
      const angle = start + (end - start) * progress;
      const radius = requireNumber(parameters, "beamWidthPx", topology) / 2;
      const length = farthestCornerDistance(pivot) + radius * 2;
      const radians = angle * Math.PI / 180;
      capsules.push(capsule(
        "sweep",
        pivot,
        point(pivot.x + Math.cos(radians) * length, pivot.y + Math.sin(radians) * length),
        radius,
      ));
      break;
    }
    case "bifurcating_y": {
      const root = viewportPoint(requirePointParameter(parameters, "root", topology));
      const fork = viewportPoint(requirePointParameter(parameters, "fork", topology));
      const ends = requirePoints(parameters, "ends", topology).map(viewportPoint);
      if (ends.length < 2) throw new Error(`${topology}.ends requires at least two points`);
      const radius = requireNumber(parameters, "branchWidthPx", topology) / 2;
      capsules.push(capsule("root", root, fork, radius));
      ends.forEach((end, index) => capsules.push(capsule(`branch:${index}`, fork, end, radius)));
      break;
    }
    case "quadratic_bezier": {
      const p0 = viewportPoint(requirePointParameter(parameters, "p0", topology));
      const p1 = viewportPoint(requirePointParameter(parameters, "p1", topology));
      const p2 = viewportPoint(requirePointParameter(parameters, "p2", topology));
      const flattened = flattenQuadraticBezier(p0, p1, p2, definition.collision.sampleTolerancePx);
      const radius = requireNumber(parameters, "widthPx", topology) / 2;
      for (let index = 0; index < flattened.length - 1; index += 1) {
        const from = flattened[index];
        const to = flattened[index + 1];
        if (from && to) capsules.push(capsule(`curve:${index}`, from, to, radius));
      }
      break;
    }
    case "twin_arcs": {
      const centers = requirePoints(parameters, "centers", topology).map(viewportPoint);
      const radii = requireNumberArray(parameters, "radiiPx", topology);
      if (centers.length !== radii.length || centers.length === 0) {
        throw new Error(`${topology} centers and radiiPx must have equal non-zero length`);
      }
      const start = requireNumber(parameters, "startDeg", topology);
      const end = requireNumber(parameters, "endDeg", topology);
      const width = requireNumber(parameters, "widthPx", topology) / 2;
      centers.forEach((center, arcIndex) => {
        const arcRadius = radii[arcIndex];
        if (arcRadius === undefined || arcRadius <= 0) throw new Error(`${topology}.radiiPx must be positive`);
        const points = flattenArc(center, arcRadius, start, end, definition.collision.sampleTolerancePx);
        for (let index = 0; index < points.length - 1; index += 1) {
          const from = points[index];
          const to = points[index + 1];
          if (from && to) capsules.push(capsule(`arc:${arcIndex}:${index}`, from, to, width));
        }
      });
      break;
    }
    case "orthogonal_shutter_grid": {
      const vertical = requireNumberArray(parameters, "verticalX", topology);
      const horizontal = requireNumberArray(parameters, "horizontalY", topology);
      const periodMs = requireNumber(parameters, "phasePeriodMs", topology);
      if (periodMs <= 0) throw new Error(`${topology}.phasePeriodMs must be positive`);
      const radius = requireNumber(parameters, "widthPx", topology) / 2;
      const phase = Math.floor(activeElapsedTicks * 1000 / LASER_TICK_HZ / periodMs) % 2;
      if (phase === 0) {
        vertical.forEach((x, index) => capsules.push(capsule(
          `vertical:${index}`,
          point(x * LASER_VIEW_WIDTH, 0),
          point(x * LASER_VIEW_WIDTH, LASER_VIEW_HEIGHT),
          radius,
        )));
      } else {
        horizontal.forEach((y, index) => capsules.push(capsule(
          `horizontal:${index}`,
          point(0, y * LASER_VIEW_HEIGHT),
          point(LASER_VIEW_WIDTH, y * LASER_VIEW_HEIGHT),
          radius,
        )));
      }
      break;
    }
    case "broken_iris_cone": {
      const origin = viewportPoint(requirePointParameter(parameters, "origin", topology));
      const innerRadius = requireNumber(parameters, "innerRadiusPx", topology);
      const outerRadius = requireNumber(parameters, "outerRadiusPx", topology);
      const startDeg = requireNumber(parameters, "startDeg", topology);
      const endDeg = requireNumber(parameters, "endDeg", topology);
      const missingHalf = requireNumber(parameters, "missingSectorDeg", topology) / 2;
      if (innerRadius < 0 || outerRadius <= innerRadius || endDeg <= startDeg) {
        throw new Error(`${topology} has an invalid annular sector`);
      }
      sectors.push(Object.freeze({
        kind: "annular-sector-minus-wedge",
        stableId: "sector",
        origin,
        innerRadius,
        outerRadius,
        startDeg,
        endDeg,
        missingStartDeg: 90 - missingHalf,
        missingEndDeg: 90 + missingHalf,
      }));
      break;
    }
    default:
      throw new Error(`unknown V4 laser topology: ${topology}`);
  }

  capsules.sort((left, right) => compareStableId(left.stableId, right.stableId));
  sectors.sort((left, right) => compareStableId(left.stableId, right.stableId));
  return Object.freeze({
    laserId: definition.id,
    topology,
    tick120: context.tick120,
    activeElapsedTicks,
    capsules: Object.freeze(capsules),
    sectors: Object.freeze(sectors),
  });
}

function compareStableId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function farthestCornerDistance(origin: Vec2): number {
  return Math.max(
    Math.hypot(origin.x, origin.y),
    Math.hypot(LASER_VIEW_WIDTH - origin.x, origin.y),
    Math.hypot(origin.x, LASER_VIEW_HEIGHT - origin.y),
    Math.hypot(LASER_VIEW_WIDTH - origin.x, LASER_VIEW_HEIGHT - origin.y),
  );
}

function flattenQuadraticBezier(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  tolerance: number,
): readonly Vec2[] {
  const result: Vec2[] = [p0];
  const recurse = (a: Vec2, control: Vec2, b: Vec2, depth: number): void => {
    if (depth >= 16 || pointToSegmentDistance(control, a, b) <= Math.max(0.1, tolerance)) {
      result.push(b);
      return;
    }
    const ab = point((a.x + control.x) / 2, (a.y + control.y) / 2);
    const bc = point((control.x + b.x) / 2, (control.y + b.y) / 2);
    const midpoint = point((ab.x + bc.x) / 2, (ab.y + bc.y) / 2);
    recurse(a, ab, midpoint, depth + 1);
    recurse(midpoint, bc, b, depth + 1);
  };
  recurse(p0, p1, p2, 0);
  return result;
}

function flattenArc(
  center: Vec2,
  radius: number,
  startDeg: number,
  endDeg: number,
  tolerance: number,
): readonly Vec2[] {
  const span = Math.abs(endDeg - startDeg) * Math.PI / 180;
  const safeTolerance = Math.max(0.1, Math.min(tolerance, radius));
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - safeTolerance / radius)));
  const segmentCount = Math.max(1, Math.ceil(span / Math.max(0.001, maxStep)));
  return Array.from({length: segmentCount + 1}, (_, index) => {
    const progress = index / segmentCount;
    const radians = (startDeg + (endDeg - startDeg) * progress) * Math.PI / 180;
    return point(center.x + Math.cos(radians) * radius, center.y + Math.sin(radians) * radius);
  });
}

export interface SweptCapsule {
  readonly kind: "swept-capsule";
  readonly stableId: string;
  readonly fromTick120: number;
  readonly toTick120: number;
  readonly previous: CapsuleSegment;
  readonly current: CapsuleSegment;
}

export interface LaserWarningFootprint {
  readonly laserId: string;
  readonly activeDurationTicks: number;
  readonly snapshots: readonly LaserGeometrySnapshot[];
  readonly sweptCapsules: readonly SweptCapsule[];
}

function capsuleSweep(previous: CapsuleSegment, current: CapsuleSegment, fromTick120: number, toTick120: number): SweptCapsule {
  return Object.freeze({
    kind: "swept-capsule",
    stableId: current.stableId,
    fromTick120,
    toTick120,
    previous,
    current,
  });
}

function isWrapDiscontinuity(previous: CapsuleSegment, current: CapsuleSegment): boolean {
  return Math.abs(previous.from.x - current.from.x) > LASER_VIEW_WIDTH / 2
    || Math.abs(previous.from.y - current.from.y) > LASER_VIEW_HEIGHT / 2
    || Math.abs(previous.to.x - current.to.x) > LASER_VIEW_WIDTH / 2
    || Math.abs(previous.to.y - current.to.y) > LASER_VIEW_HEIGHT / 2;
}

export function buildLaserWarningFootprint(
  definitionOrId: LaserDefinition | string,
): LaserWarningFootprint {
  const definition = typeof definitionOrId === "string"
    ? laserDefinition(definitionOrId)
    : definitionOrId;
  validateLaserDefinition(definition);
  const activeDurationTicks = millisecondsToAuthorityTicks(definition.lifecycle.timingMs.live);
  const snapshots: LaserGeometrySnapshot[] = [];
  const sweptCapsules: SweptCapsule[] = [];
  for (let tick120 = 0; tick120 <= activeDurationTicks; tick120 += 1) {
    const snapshot = compileLaserGeometry(definition, {
      tick120,
      activeStartTick120: 0,
      activeDurationTicks,
    });
    const previous = snapshots[snapshots.length - 1];
    if (previous) {
      const previousById = new Map(previous.capsules.map((entry) => [entry.stableId, entry]));
      for (const current of snapshot.capsules) {
        const prior = previousById.get(current.stableId);
        if (prior && !isWrapDiscontinuity(prior, current)) {
          sweptCapsules.push(capsuleSweep(prior, current, previous.tick120, snapshot.tick120));
        }
      }
    }
    snapshots.push(snapshot);
  }
  return Object.freeze({
    laserId: definition.id,
    activeDurationTicks,
    snapshots: Object.freeze(snapshots),
    sweptCapsules: Object.freeze(sweptCapsules),
  });
}

export function warningFootprintCoversSnapshot(
  footprint: LaserWarningFootprint,
  snapshot: LaserGeometrySnapshot,
): boolean {
  if (footprint.laserId !== snapshot.laserId) return false;
  const authored = footprint.snapshots[snapshot.activeElapsedTicks];
  if (!authored) return false;
  if (authored.capsules.length !== snapshot.capsules.length
    || authored.sectors.length !== snapshot.sectors.length) return false;
  return authored.capsules.every((capsuleEntry, index) =>
    equalCapsule(capsuleEntry, snapshot.capsules[index]))
    && authored.sectors.every((sector, index) => equalSector(sector, snapshot.sectors[index]));
}

function equalPoint(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y;
}

function equalCapsule(left: CapsuleSegment, right: CapsuleSegment | undefined): boolean {
  return right !== undefined
    && left.stableId === right.stableId
    && left.radius === right.radius
    && equalPoint(left.from, right.from)
    && equalPoint(left.to, right.to);
}

function equalSector(left: AnnularSector, right: AnnularSector | undefined): boolean {
  return right !== undefined
    && left.stableId === right.stableId
    && equalPoint(left.origin, right.origin)
    && left.innerRadius === right.innerRadius
    && left.outerRadius === right.outerRadius
    && left.startDeg === right.startDeg
    && left.endDeg === right.endDeg
    && left.missingStartDeg === right.missingStartDeg
    && left.missingEndDeg === right.missingEndDeg;
}

export interface CircleSweep {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly radius: number;
}

export function playerSweepIntersectsCapsule(
  player: CircleSweep,
  laser: CapsuleSegment,
): boolean {
  assertFiniteNonNegative(player.radius, "player sweep radius");
  return segmentToSegmentDistance(player.from, player.to, laser.from, laser.to)
    <= player.radius + laser.radius;
}

export function playerSweepIntersectsGeometry(
  player: CircleSweep,
  geometry: LaserGeometrySnapshot,
): boolean {
  return geometry.capsules.some((entry) => playerSweepIntersectsCapsule(player, entry))
    || geometry.sectors.some((entry) => playerSweepIntersectsSector(player, entry));
}

function playerSweepIntersectsSector(player: CircleSweep, sector: AnnularSector): boolean {
  const length = Math.hypot(player.to.x - player.from.x, player.to.y - player.from.y);
  const samples = Math.max(1, Math.ceil(length / 0.5));
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    const position = point(
      player.from.x + (player.to.x - player.from.x) * progress,
      player.from.y + (player.to.y - player.from.y) * progress,
    );
    if (pointToBrokenSectorDistance(position, sector) <= player.radius) return true;
  }
  return false;
}

function pointToBrokenSectorDistance(position: Vec2, sector: AnnularSector): number {
  const intervals: readonly (readonly [number, number])[] = [
    [sector.startDeg, Math.min(sector.endDeg, sector.missingStartDeg)],
    [Math.max(sector.startDeg, sector.missingEndDeg), sector.endDeg],
  ];
  return Math.min(...intervals
    .filter(([start, end]) => end >= start)
    .map(([start, end]) => pointToAnnularSectorDistance(position, sector, start, end)));
}

function pointToAnnularSectorDistance(
  position: Vec2,
  sector: AnnularSector,
  startDeg: number,
  endDeg: number,
): number {
  const dx = position.x - sector.origin.x;
  const dy = position.y - sector.origin.y;
  const radius = Math.hypot(dx, dy);
  const angle = normalizeDegrees(Math.atan2(dy, dx) * 180 / Math.PI);
  let minimum = Number.POSITIVE_INFINITY;
  if (angle >= startDeg && angle <= endDeg) {
    minimum = Math.min(
      Math.abs(radius - Math.max(sector.innerRadius, Math.min(sector.outerRadius, radius))),
    );
  }
  for (const boundary of [startDeg, endDeg]) {
    const radians = boundary * Math.PI / 180;
    const from = point(
      sector.origin.x + Math.cos(radians) * sector.innerRadius,
      sector.origin.y + Math.sin(radians) * sector.innerRadius,
    );
    const to = point(
      sector.origin.x + Math.cos(radians) * sector.outerRadius,
      sector.origin.y + Math.sin(radians) * sector.outerRadius,
    );
    minimum = Math.min(minimum, pointToSegmentDistance(position, from, to));
  }
  return minimum;
}

function normalizeDegrees(value: number): number {
  return modulo(value, 360);
}

function sweptCapsuleIntersectsPlayer(player: CircleSweep, sweep: SweptCapsule): boolean {
  if (playerSweepIntersectsCapsule(player, sweep.previous)
    || playerSweepIntersectsCapsule(player, sweep.current)) return true;
  const polygon = [
    sweep.previous.from,
    sweep.previous.to,
    sweep.current.to,
    sweep.current.from,
  ];
  const radius = Math.max(sweep.previous.radius, sweep.current.radius) + player.radius;
  if (pointInPolygon(player.from, polygon) || pointInPolygon(player.to, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    if (from && to && segmentToSegmentDistance(player.from, player.to, from, to) <= radius) return true;
  }
  return false;
}

function pointInPolygon(value: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    if (!current || !previous) continue;
    const crosses = (current.y > value.y) !== (previous.y > value.y)
      && value.x < (previous.x - current.x) * (value.y - current.y)
        / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function laserIntersectsPlayerBetweenTicks(
  definitionOrId: LaserDefinition | string,
  fromTick120: number,
  toTick120: number,
  activeStartTick120: number,
  activeDurationTicks: number,
  player: CircleSweep,
): boolean {
  const definition = typeof definitionOrId === "string"
    ? laserDefinition(definitionOrId)
    : definitionOrId;
  assertTick(fromTick120, "collision fromTick120");
  assertTick(toTick120, "collision toTick120");
  if (toTick120 < fromTick120) throw new Error("collision tick range must be monotonic");
  const start = Math.max(fromTick120, activeStartTick120);
  const end = Math.min(toTick120, activeStartTick120 + activeDurationTicks);
  if (end < start) return false;
  const totalTicks = Math.max(1, toTick120 - fromTick120);
  let previous = compileLaserGeometry(definition, {
    tick120: start,
    activeStartTick120,
    activeDurationTicks,
  });
  if (fromTick120 === toTick120) return playerSweepIntersectsGeometry(player, previous);
  if (start === end) {
    const progress = (start - fromTick120) / totalTicks;
    const atBoundary = point(
      player.from.x + (player.to.x - player.from.x) * progress,
      player.from.y + (player.to.y - player.from.y) * progress,
    );
    return playerSweepIntersectsGeometry({from: atBoundary, to: atBoundary, radius: player.radius}, previous);
  }
  for (let tick120 = start + 1; tick120 <= end; tick120 += 1) {
    const current = compileLaserGeometry(definition, {
      tick120,
      activeStartTick120,
      activeDurationTicks,
    });
    const priorProgress = (tick120 - 1 - fromTick120) / totalTicks;
    const currentProgress = (tick120 - fromTick120) / totalTicks;
    const playerInterval: CircleSweep = {
      from: point(
        player.from.x + (player.to.x - player.from.x) * Math.max(0, priorProgress),
        player.from.y + (player.to.y - player.from.y) * Math.max(0, priorProgress),
      ),
      to: point(
        player.from.x + (player.to.x - player.from.x) * Math.min(1, currentProgress),
        player.from.y + (player.to.y - player.from.y) * Math.min(1, currentProgress),
      ),
      radius: player.radius,
    };
    const previousById = new Map(previous.capsules.map((entry) => [entry.stableId, entry]));
    if (playerSweepIntersectsGeometry(playerInterval, current)
      || current.capsules.some((entry) => {
        const prior = previousById.get(entry.stableId);
        return prior !== undefined
          && !isWrapDiscontinuity(prior, entry)
          && sweptCapsuleIntersectsPlayer(playerInterval, capsuleSweep(prior, entry, tick120 - 1, tick120));
      })) return true;
    previous = current;
  }
  return false;
}

function pointToSegmentDistance(value: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const denominator = dx * dx + dy * dy;
  const progress = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((value.x - from.x) * dx + (value.y - from.y) * dy) / denominator));
  return Math.hypot(value.x - (from.x + dx * progress), value.y - (from.y + dy * progress));
}

function segmentToSegmentDistance(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): number {
  if (segmentsIntersect(a0, a1, b0, b1)) return 0;
  return Math.min(
    pointToSegmentDistance(a0, b0, b1),
    pointToSegmentDistance(a1, b0, b1),
    pointToSegmentDistance(b0, a0, a1),
    pointToSegmentDistance(b1, a0, a1),
  );
}

function segmentsIntersect(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
  const orientation = (p0: Vec2, p1: Vec2, p2: Vec2): number =>
    (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
  const onSegment = (p0: Vec2, p1: Vec2, value: Vec2): boolean =>
    value.x >= Math.min(p0.x, p1.x) && value.x <= Math.max(p0.x, p1.x)
    && value.y >= Math.min(p0.y, p1.y) && value.y <= Math.max(p0.y, p1.y);
  const first = orientation(a0, a1, b0);
  const second = orientation(a0, a1, b1);
  const third = orientation(b0, b1, a0);
  const fourth = orientation(b0, b1, a1);
  if (((first > 0 && second < 0) || (first < 0 && second > 0))
    && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))) return true;
  return (first === 0 && onSegment(a0, a1, b0))
    || (second === 0 && onSegment(a0, a1, b1))
    || (third === 0 && onSegment(b0, b1, a0))
    || (fourth === 0 && onSegment(b0, b1, a1));
}

export type LaserLifecycleState =
  | "idle"
  | "warning"
  | "arming"
  | "active"
  | "shutdown"
  | "residue"
  | "cleanup";

export type LaserTerminalCause = "cancel" | "impact";

export interface LaserLifecycleSnapshot {
  readonly instanceId: string;
  readonly laserId: string;
  readonly generation: number;
  readonly state: LaserLifecycleState;
  readonly collisionEnabled: boolean;
  readonly currentTick120: number;
  readonly warningEndTick120: number | null;
  readonly activeTick120: number | null;
  readonly terminalTick120: number | null;
  readonly residueTick120: number | null;
  readonly cleanupTick120: number | null;
  readonly terminalCause: LaserTerminalCause | null;
}

/**
 * Entity-owned laser lifecycle. It has no presentation command port: feedback
 * only receives immutable events from CanonicalEventBus after gameplay commit.
 */
export class LaserAuthority {
  private stateValue: LaserLifecycleState = "idle";
  private collisionEnabledValue = false;
  private generationValue = 0;
  private currentTickValue = 0;
  private warningEndTick: number | null = null;
  private activeTick: number | null = null;
  private terminalTick: number | null = null;
  private residueTick: number | null = null;
  private cleanupTick: number | null = null;
  private terminalCause: LaserTerminalCause | null = null;
  private localSequence = 0;

  readonly definition: LaserDefinition;

  constructor(
    private readonly bus: CanonicalEventBus,
    definitionOrId: LaserDefinition | string,
    readonly instanceId: string,
  ) {
    if (!instanceId) throw new Error("laser instanceId is required");
    this.definition = typeof definitionOrId === "string"
      ? laserDefinition(definitionOrId)
      : definitionOrId;
    validateLaserDefinition(this.definition);
    // Compile once so an unknown or malformed topology fails before gameplay.
    compileLaserGeometry(this.definition, {tick120: 0});
  }

  snapshot(): LaserLifecycleSnapshot {
    return Object.freeze({
      instanceId: this.instanceId,
      laserId: this.definition.id,
      generation: this.generationValue,
      state: this.stateValue,
      collisionEnabled: this.collisionEnabledValue,
      currentTick120: this.currentTickValue,
      warningEndTick120: this.warningEndTick,
      activeTick120: this.activeTick,
      terminalTick120: this.terminalTick,
      residueTick120: this.residueTick,
      cleanupTick120: this.cleanupTick,
      terminalCause: this.terminalCause,
    });
  }

  start(tick120: number): LaserLifecycleSnapshot {
    assertTick(tick120, "laser start tick120");
    if (this.stateValue !== "idle" && this.stateValue !== "cleanup") {
      throw new Error(`laser cannot start from ${this.stateValue}`);
    }
    if (tick120 < this.currentTickValue) throw new Error("laser start tick must be monotonic");
    const nextGeneration = this.stateValue === "cleanup" ? this.generationValue + 1 : this.generationValue;
    const timing = this.definition.lifecycle.timingMs;
    const warningEnd = tick120 + millisecondsToAuthorityTicks(timing.telegraph);
    const active = tick120 + millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);
    const terminal = active + millisecondsToAuthorityTicks(timing.live);

    this.emit("projectile.spawn.commit", tick120, "spawn", {
      instanceId: this.instanceId,
      generation: nextGeneration,
      archetypeId: this.definition.id,
      topology: this.definition.geometry.type,
    }, nextGeneration);

    this.generationValue = nextGeneration;
    this.localSequence = 1;
    this.currentTickValue = tick120;
    this.stateValue = "warning";
    this.collisionEnabledValue = false;
    this.warningEndTick = warningEnd;
    this.activeTick = active;
    this.terminalTick = terminal;
    this.residueTick = null;
    this.cleanupTick = null;
    this.terminalCause = null;
    return this.snapshot();
  }

  advance(toTick120: number): LaserLifecycleSnapshot {
    assertTick(toTick120, "laser advance tick120");
    if (toTick120 < this.currentTickValue) throw new Error("laser advance tick must be monotonic");
    let progressed = true;
    while (progressed) {
      progressed = false;
      if (this.stateValue === "warning" && this.warningEndTick !== null
        && toTick120 >= this.warningEndTick) {
        const due = this.warningEndTick;
        const ready = this.activeTick;
        if (ready === null) throw new Error("laser active boundary is missing");
        this.emit("projectile.arm.begin", due, "arm-begin", {
          instanceId: this.instanceId,
          generation: this.generationValue,
          readyAtMs: simulationTimeMsForTick(ready),
          warningShape: this.definition.warning.geometry,
        });
        this.stateValue = "arming";
        progressed = true;
      }
      if (this.stateValue === "arming" && this.activeTick !== null && toTick120 >= this.activeTick) {
        const due = this.activeTick;
        this.emit("projectile.armed", due, "armed", {
          instanceId: this.instanceId,
          generation: this.generationValue,
        });
        this.emit("projectile.collision.on", due, "collision-on", {
          instanceId: this.instanceId,
          generation: this.generationValue,
        });
        this.emit("projectile.flight.begin", due, "flight-begin", {
          instanceId: this.instanceId,
          generation: this.generationValue,
          ownership: "entity",
          topology: this.definition.geometry.type,
        });
        this.stateValue = "active";
        this.collisionEnabledValue = true;
        progressed = true;
      }
      if (this.stateValue === "active" && this.terminalTick !== null
        && toTick120 >= this.terminalTick) {
        this.commitTerminal(this.terminalTick, "cancel", "lifecycle-shutdown", undefined);
        progressed = true;
      }
      if (this.stateValue === "shutdown" && this.residueTick !== null
        && toTick120 >= this.residueTick) {
        const due = this.residueTick;
        const cleanup = this.cleanupTick;
        const cause = this.terminalCause;
        if (cleanup === null || cause === null) throw new Error("laser residue boundaries are missing");
        this.emit("projectile.residue.begin", due, "residue-begin", {
          instanceId: this.instanceId,
          generation: this.generationValue,
          cause,
          removeAtMs: simulationTimeMsForTick(cleanup),
          residueId: this.definition.cancel.toResidue,
        });
        this.stateValue = "residue";
        progressed = true;
      }
      if (this.stateValue === "residue" && this.cleanupTick !== null
        && toTick120 >= this.cleanupTick) {
        const due = this.cleanupTick;
        const cause = this.terminalCause;
        if (cause === null) throw new Error("laser cleanup cause is missing");
        this.emit("projectile.residue.remove", due, "residue-remove", {
          instanceId: this.instanceId,
          generation: this.generationValue,
          cause,
        });
        this.emit("projectile.lifecycle.complete", due, "complete", {
          instanceId: this.instanceId,
          generation: this.generationValue,
          cause,
        });
        this.stateValue = "cleanup";
        progressed = true;
      }
    }
    this.currentTickValue = toTick120;
    return this.snapshot();
  }

  cancel(tick120: number, reason: string): LaserLifecycleSnapshot {
    if (!reason) throw new Error("laser cancel reason is required");
    this.advance(tick120);
    if (this.stateValue !== "warning" && this.stateValue !== "arming" && this.stateValue !== "active") {
      throw new Error(`laser cannot cancel from ${this.stateValue}`);
    }
    this.commitTerminal(tick120, "cancel", reason, undefined);
    return this.snapshot();
  }

  impact(tick120: number, targetId: string): LaserLifecycleSnapshot {
    if (!targetId) throw new Error("laser impact targetId is required");
    this.advance(tick120);
    if (this.stateValue !== "active") throw new Error(`laser cannot impact from ${this.stateValue}`);
    this.commitTerminal(tick120, "impact", undefined, targetId);
    return this.snapshot();
  }

  activeGeometry(tick120 = this.currentTickValue): LaserGeometrySnapshot {
    if (this.activeTick === null) throw new Error("laser has not started");
    return compileLaserGeometry(this.definition, {
      tick120,
      activeStartTick120: this.activeTick,
      activeDurationTicks: millisecondsToAuthorityTicks(this.definition.lifecycle.timingMs.live),
    });
  }

  warningFootprint(): LaserWarningFootprint {
    return buildLaserWarningFootprint(this.definition);
  }

  collides(
    fromTick120: number,
    toTick120: number,
    player: CircleSweep,
  ): boolean {
    if (this.activeTick === null || this.terminalTick === null) return false;
    if (toTick120 > this.currentTickValue) {
      throw new Error("laser collision cannot query a future authority tick");
    }
    const lastCollisionTick = this.terminalTick - 1;
    if (toTick120 < this.activeTick || fromTick120 > lastCollisionTick) return false;
    return laserIntersectsPlayerBetweenTicks(
      this.definition,
      fromTick120,
      toTick120,
      this.activeTick,
      Math.max(0, lastCollisionTick - this.activeTick),
      player,
    );
  }

  private commitTerminal(
    tick120: number,
    cause: LaserTerminalCause,
    reason: string | undefined,
    targetId: string | undefined,
  ): void {
    this.emit("projectile.collision.off", tick120, "collision-off", {
      instanceId: this.instanceId,
      generation: this.generationValue,
      reason: cause === "impact" ? "impact" : (reason ?? "cancel"),
    });
    if (cause === "impact") {
      this.emit("projectile.impact.commit", tick120, "impact", {
        instanceId: this.instanceId,
        generation: this.generationValue,
        targetId: targetId ?? "unknown",
      });
    } else {
      this.emit("projectile.cancel.commit", tick120, "cancel", {
        instanceId: this.instanceId,
        generation: this.generationValue,
        reason: reason ?? "cancel",
      });
    }
    const shutdownTicks = millisecondsToAuthorityTicks(this.definition.lifecycle.timingMs.shutdown);
    const residueTicks = millisecondsToAuthorityTicks(this.definition.lifecycle.timingMs.residue);
    this.stateValue = "shutdown";
    this.collisionEnabledValue = false;
    this.terminalTick = tick120;
    this.terminalCause = cause;
    this.residueTick = tick120 + shutdownTicks;
    this.cleanupTick = tick120 + shutdownTicks + residueTicks;
  }

  private emit(
    id: string,
    tick120: number,
    suffix: string,
    payload: Readonly<Record<string, unknown>>,
    generation = this.generationValue,
  ): void {
    const sequence = suffix === "spawn" ? 0 : this.localSequence;
    this.bus.enqueue({
      id,
      tick120,
      entityStableId: this.instanceId,
      localSequence: sequence,
      occurrenceKey: `${this.instanceId}:${generation}:${suffix}`,
      payload,
    });
    if (suffix !== "spawn") this.localSequence += 1;
  }
}

/** Convenience helper preserving the bus's read-only feedback boundary. */
export function flushLaserEvents(
  bus: CanonicalEventBus,
  feedbackSinks: readonly ReadonlyFeedbackSink[] = [],
): readonly CanonicalGameplayEvent[] {
  return bus.flush(feedbackSinks);
}
