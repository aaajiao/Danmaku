export type RuntimeChannel = "gameplay" | "visual" | "system";
export type TimelineStatus = "idle" | "running" | "completed" | "cancelled";

export interface ScheduledEventSpec {
  id: string;
  atMs: number;
  priority?: number;
  channel?: RuntimeChannel;
}

export interface EventTimelineSpec {
  id: string;
  durationMs: number;
  events: ScheduledEventSpec[];
  loop?: boolean;
  maxLoops?: number;
  completionEvent?: string;
  completionPriority?: number;
  cancelEvent?: string;
  cancelPriority?: number;
  maximumBoundariesPerAdvance?: number;
}

export interface RuntimeEvent {
  id: string;
  channel: RuntimeChannel;
  kind: "scheduled" | "complete" | "cancel" | "state-entry" | "diagnostic";
  priority: number;
  simulationTimeMs: number;
  elapsedMs: number;
  timelineId: string;
  instanceId: string;
  generation: number;
  loopIndex: number;
  declarationOrder: number;
  occurrenceKey: string;
  state?: LaserState;
  cycleId?: number;
}

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

function sortRuntimeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.sort((a, b) =>
    a.simulationTimeMs - b.simulationTimeMs ||
    a.priority - b.priority ||
    a.declarationOrder - b.declarationOrder,
  );
}

/**
 * Gameplay-authoritative event timeline.
 * start() emits t=0; advance() emits every event in (previous, next].
 */
export class EventTimeline {
  readonly spec: Readonly<EventTimelineSpec>;
  readonly instanceId: string;
  status: TimelineStatus = "idle";
  generation = 0;
  elapsedMs = 0;
  startSimulationTimeMs = 0;
  loopIndex = 0;
  private cancelEmitted = false;
  private completionEmitted = false;

  constructor(spec: EventTimelineSpec, instanceId = spec.id) {
    if (!spec.id) throw new Error("timeline id is required");
    if (!Number.isFinite(spec.durationMs) || spec.durationMs <= 0) {
      throw new Error("durationMs must be finite and greater than zero");
    }
    if (spec.maxLoops !== undefined && (!Number.isInteger(spec.maxLoops) || spec.maxLoops < 1)) {
      throw new Error("maxLoops must be a positive integer");
    }
    for (const event of spec.events) {
      finiteNonNegative(event.atMs, `event ${event.id}.atMs`);
      if (event.atMs > spec.durationMs) {
        throw new Error(`event ${event.id} is after timeline duration`);
      }
    }
    this.spec = Object.freeze({...spec, events: spec.events.map((event) => Object.freeze({...event}))});
    this.instanceId = instanceId;
  }

  private totalLoops(): number {
    if (this.spec.maxLoops !== undefined) return this.spec.maxLoops;
    return this.spec.loop ? Number.POSITIVE_INFINITY : 1;
  }

  private totalDurationMs(): number {
    const loops = this.totalLoops();
    return Number.isFinite(loops) ? loops * this.spec.durationMs : Number.POSITIVE_INFINITY;
  }

  start(simulationTimeMs = 0): RuntimeEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    if (this.status !== "idle") this.generation += 1;
    this.status = "running";
    this.elapsedMs = 0;
    this.loopIndex = 0;
    this.startSimulationTimeMs = simulationTimeMs;
    this.cancelEmitted = false;
    this.completionEmitted = false;
    const events = this.spec.events
      .map((event, index) => ({event, index}))
      .filter(({event}) => event.atMs === 0)
      .map(({event, index}) => this.makeScheduled(event, index, 0, 0));
    return sortRuntimeEvents(events);
  }

  advance(deltaMs: number): RuntimeEvent[] {
    finiteNonNegative(deltaMs, "deltaMs");
    if (deltaMs === 0 || this.status !== "running") return [];

    const previous = this.elapsedMs;
    const unclampedTarget = previous + deltaMs;
    const totalDuration = this.totalDurationMs();
    const target = Math.min(unclampedTarget, totalDuration);
    const duration = this.spec.durationMs;
    const firstLoop = Math.max(0, Math.floor(previous / duration) - 1);
    const lastLoop = Math.min(
      Number.isFinite(this.totalLoops()) ? this.totalLoops() - 1 : Math.floor(target / duration),
      Math.floor(target / duration),
    );
    const loopBoundariesCrossed = Math.max(0, Math.floor(target / duration) - Math.floor(previous / duration));
    const maxBoundaries = this.spec.maximumBoundariesPerAdvance ?? 1024;
    if (loopBoundariesCrossed > maxBoundaries) {
      throw new Error(`timeline ${this.spec.id} crossed more than ${maxBoundaries} loop boundaries`);
    }

    const candidates: RuntimeEvent[] = [];
    for (let loop = firstLoop; loop <= lastLoop; loop += 1) {
      const loopBase = loop * duration;
      this.spec.events.forEach((event, eventIndex) => {
        const absoluteElapsed = loopBase + event.atMs;
        if (absoluteElapsed > previous && absoluteElapsed <= target) {
          candidates.push(this.makeScheduled(event, eventIndex, loop, absoluteElapsed));
        }
      });
    }

    if (Number.isFinite(totalDuration) && target === totalDuration && !this.completionEmitted) {
      if (this.spec.completionEvent) {
        candidates.push(this.makeTerminalEvent(
          this.spec.completionEvent,
          "complete",
          totalDuration,
          this.spec.completionPriority ?? 90,
          Math.max(0, this.totalLoops() - 1),
        ));
      }
    }

    if (candidates.length + loopBoundariesCrossed > maxBoundaries) {
      throw new Error(`timeline ${this.spec.id} crossed more than ${maxBoundaries} event boundaries`);
    }

    this.elapsedMs = target;
    this.loopIndex = Math.min(
      Math.floor(target / duration),
      Number.isFinite(this.totalLoops()) ? this.totalLoops() - 1 : Number.MAX_SAFE_INTEGER,
    );
    if (Number.isFinite(totalDuration) && target === totalDuration) {
      this.status = "completed";
      this.completionEmitted = true;
    }
    return sortRuntimeEvents(candidates);
  }

  cancel(): RuntimeEvent[] {
    if (this.status !== "running" || this.cancelEmitted) return [];
    this.status = "cancelled";
    this.cancelEmitted = true;
    if (!this.spec.cancelEvent) return [];
    return [this.makeTerminalEvent(this.spec.cancelEvent, "cancel", this.elapsedMs, this.spec.cancelPriority ?? 10)];
  }

  private makeScheduled(
    event: Readonly<ScheduledEventSpec>,
    eventIndex: number,
    loopIndex: number,
    absoluteElapsed: number,
  ): RuntimeEvent {
    return {
      id: event.id,
      channel: event.channel ?? "gameplay",
      kind: "scheduled",
      priority: event.priority ?? 10,
      simulationTimeMs: this.startSimulationTimeMs + absoluteElapsed,
      elapsedMs: absoluteElapsed,
      timelineId: this.spec.id,
      instanceId: this.instanceId,
      generation: this.generation,
      loopIndex,
      declarationOrder: eventIndex,
      occurrenceKey: `${this.instanceId}:${this.generation}:${loopIndex}:${eventIndex}`,
    };
  }

  private makeTerminalEvent(
    id: string,
    kind: "complete" | "cancel",
    absoluteElapsed: number,
    priority: number,
    loopIndex = this.loopIndex,
  ): RuntimeEvent {
    return {
      id,
      channel: "gameplay",
      kind,
      priority,
      simulationTimeMs: this.startSimulationTimeMs + absoluteElapsed,
      elapsedMs: absoluteElapsed,
      timelineId: this.spec.id,
      instanceId: this.instanceId,
      generation: this.generation,
      loopIndex,
      declarationOrder: Number.MAX_SAFE_INTEGER,
      occurrenceKey: `${this.instanceId}:${this.generation}:${kind}`,
    };
  }
}

export type VisualProfile = "full" | "reduced-motion";

export interface VisualFrameSpec {
  id: string;
  /** Includes any deliberate hold time. */
  durationMs: number;
}

export interface VisualTrackSpec {
  id: string;
  frames: VisualFrameSpec[];
  reducedMotionFrame: string;
  loop?: boolean;
  maxLoops?: number;
  maximumBoundariesPerAdvance?: number;
}

export interface VisualSignal {
  kind: "frame" | "complete" | "cancel";
  channel: "visual";
  visualTimeMs: number;
  frameId?: string;
  loopIndex: number;
}

/** Visual-only playback; it cannot produce RuntimeEvent objects. */
export class VisualTrack {
  readonly spec: Readonly<VisualTrackSpec>;
  status: TimelineStatus = "idle";
  profile: VisualProfile;
  visualTimeMs = 0;
  frameIndex = 0;
  loopIndex = 0;
  private completedEmitted = false;
  private cancelledEmitted = false;

  constructor(spec: VisualTrackSpec, profile: VisualProfile = "full") {
    if (spec.frames.length === 0) throw new Error("visual track requires at least one frame");
    for (const frame of spec.frames) {
      if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) {
        throw new Error(`frame ${frame.id} duration must be greater than zero`);
      }
    }
    if (spec.maxLoops !== undefined && (!Number.isInteger(spec.maxLoops) || spec.maxLoops < 1)) {
      throw new Error("visual maxLoops must be a positive integer");
    }
    this.spec = Object.freeze({...spec, frames: spec.frames.map((frame) => Object.freeze({...frame}))});
    this.profile = profile;
  }

  private loopDurationMs(): number {
    return this.spec.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  }

  private totalLoops(): number {
    if (this.spec.maxLoops !== undefined) return this.spec.maxLoops;
    return this.spec.loop ? Number.POSITIVE_INFINITY : 1;
  }

  private displayedFrame(): string {
    return this.profile === "reduced-motion"
      ? this.spec.reducedMotionFrame
      : this.spec.frames[this.frameIndex].id;
  }

  setProfile(profile: VisualProfile): VisualSignal[] {
    if (this.profile === profile) return [];
    this.profile = profile;
    if (this.status !== "running") return [];
    return [{kind:"frame", channel:"visual", visualTimeMs:this.visualTimeMs, frameId:this.displayedFrame(), loopIndex:this.loopIndex}];
  }

  start(): VisualSignal[] {
    this.status = "running";
    this.visualTimeMs = 0;
    this.frameIndex = 0;
    this.loopIndex = 0;
    this.completedEmitted = false;
    this.cancelledEmitted = false;
    return [{kind:"frame", channel:"visual", visualTimeMs:0, frameId:this.displayedFrame(), loopIndex:0}];
  }

  advance(deltaMs: number): VisualSignal[] {
    finiteNonNegative(deltaMs, "visual deltaMs");
    if (deltaMs === 0 || this.status !== "running") return [];
    const previous = this.visualTimeMs;
    const loopDuration = this.loopDurationMs();
    const loops = this.totalLoops();
    const totalDuration = Number.isFinite(loops) ? loops * loopDuration : Number.POSITIVE_INFINITY;
    const target = Math.min(previous + deltaMs, totalDuration);
    const maxBoundaries = this.spec.maximumBoundariesPerAdvance ?? 1024;
    const signals: VisualSignal[] = [];
    let boundaryCount = 0;

    const firstLoop = Math.max(0, Math.floor(previous / loopDuration) - 1);
    const lastLoop = Math.min(
      Number.isFinite(loops) ? loops - 1 : Math.floor(target / loopDuration),
      Math.floor(target / loopDuration),
    );
    for (let loop = firstLoop; loop <= lastLoop; loop += 1) {
      let offset = loop * loopDuration;
      for (let frame = 0; frame < this.spec.frames.length; frame += 1) {
        if (frame > 0) {
          const boundary = offset;
          if (boundary > previous && boundary <= target) {
            boundaryCount += 1;
            if (this.profile === "full") {
              signals.push({kind:"frame", channel:"visual", visualTimeMs:boundary, frameId:this.spec.frames[frame].id, loopIndex:loop});
            }
          }
        }
        offset += this.spec.frames[frame].durationMs;
      }
      const nextLoopBoundary = (loop + 1) * loopDuration;
      if (loop + 1 < loops && nextLoopBoundary > previous && nextLoopBoundary <= target) {
        boundaryCount += 1;
        if (this.profile === "full") {
          signals.push({kind:"frame", channel:"visual", visualTimeMs:nextLoopBoundary, frameId:this.spec.frames[0].id, loopIndex:loop + 1});
        }
      }
    }
    if (boundaryCount > maxBoundaries) {
      throw new Error(`visual track ${this.spec.id} crossed more than ${maxBoundaries} boundaries`);
    }

    this.visualTimeMs = target;
    if (target === totalDuration && Number.isFinite(totalDuration)) {
      this.status = "completed";
      this.completedEmitted = true;
      this.frameIndex = this.spec.frames.length - 1;
      this.loopIndex = Math.max(0, loops - 1);
      signals.push({kind:"complete", channel:"visual", visualTimeMs:target, frameId:this.displayedFrame(), loopIndex:Math.max(0, loops - 1)});
    } else {
      const timeInLoop = target % loopDuration;
      let cursor = 0;
      this.frameIndex = this.spec.frames.findIndex((frame) => {
        cursor += frame.durationMs;
        return timeInLoop < cursor;
      });
      if (this.frameIndex < 0) this.frameIndex = this.spec.frames.length - 1;
      this.loopIndex = Math.floor(target / loopDuration);
    }
    return signals;
  }

  cancel(): VisualSignal[] {
    if (this.status !== "running" || this.cancelledEmitted) return [];
    this.status = "cancelled";
    this.cancelledEmitted = true;
    return [{kind:"cancel", channel:"visual", visualTimeMs:this.visualTimeMs, frameId:this.displayedFrame(), loopIndex:this.loopIndex}];
  }
}

export class DualTimeline {
  constructor(readonly gameplay: EventTimeline, readonly visual: VisualTrack) {}

  start(simulationTimeMs = 0): {gameplay: RuntimeEvent[]; visual: VisualSignal[]} {
    return {gameplay:this.gameplay.start(simulationTimeMs), visual:this.visual.start()};
  }

  advance(deltaMs: number): {gameplay: RuntimeEvent[]; visual: VisualSignal[]} {
    return {gameplay:this.gameplay.advance(deltaMs), visual:this.visual.advance(deltaMs)};
  }

  cancel(): {gameplay: RuntimeEvent[]; visual: VisualSignal[]} {
    return {gameplay:this.gameplay.cancel(), visual:this.visual.cancel()};
  }
}

export interface DomainEvent {
  id: string;
  simulationTimeMs: number;
  priority: number;
}

function sortDomainEvents(events: DomainEvent[]): DomainEvent[] {
  return events.sort((a, b) => a.simulationTimeMs - b.simulationTimeMs || a.priority - b.priority);
}

export class PlayerCollisionController {
  collidable = true;
  invulnerable = false;
  alive = true;
  private invulnerabilityEndsAtMs = Number.POSITIVE_INFINITY;
  private collisionEnablesAtMs = Number.POSITIVE_INFINITY;

  hit(simulationTimeMs: number, invulnerabilityMs = 1000): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    finiteNonNegative(invulnerabilityMs, "invulnerabilityMs");
    if (!this.alive || this.invulnerable) return [];
    this.collidable = false;
    this.invulnerable = true;
    this.invulnerabilityEndsAtMs = simulationTimeMs + invulnerabilityMs;
    this.collisionEnablesAtMs = this.invulnerabilityEndsAtMs;
    return sortDomainEvents([
      {id:"player.collision.off", simulationTimeMs, priority:0},
      {id:"player.damage.commit", simulationTimeMs, priority:10},
      {id:"player.invulnerability.begin", simulationTimeMs, priority:10},
    ]);
  }

  advanceTo(simulationTimeMs: number): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    const events: DomainEvent[] = [];
    if (this.alive && simulationTimeMs >= this.collisionEnablesAtMs) {
      const at = this.collisionEnablesAtMs;
      this.collidable = true;
      events.push({id:"player.collision.on", simulationTimeMs:at, priority:20});
      this.collisionEnablesAtMs = Number.POSITIVE_INFINITY;
    }
    if (this.invulnerable && simulationTimeMs >= this.invulnerabilityEndsAtMs) {
      const at = this.invulnerabilityEndsAtMs;
      this.invulnerable = false;
      this.invulnerabilityEndsAtMs = Number.POSITIVE_INFINITY;
      events.push({id:"player.invulnerability.end", simulationTimeMs:at, priority:10});
    }
    return sortDomainEvents(events);
  }

  kill(simulationTimeMs: number): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    if (!this.alive) return [];
    this.collidable = false;
    this.invulnerable = false;
    this.alive = false;
    this.invulnerabilityEndsAtMs = Number.POSITIVE_INFINITY;
    this.collisionEnablesAtMs = Number.POSITIVE_INFINITY;
    return sortDomainEvents([
      {id:"player.collision.off", simulationTimeMs, priority:0},
      {id:"player.death.commit", simulationTimeMs, priority:10},
    ]);
  }

  respawn(simulationTimeMs: number, collisionDelayMs: number, invulnerabilityMs: number): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    finiteNonNegative(collisionDelayMs, "collisionDelayMs");
    finiteNonNegative(invulnerabilityMs, "invulnerabilityMs");
    this.alive = true;
    this.collidable = collisionDelayMs === 0;
    this.invulnerable = true;
    this.invulnerabilityEndsAtMs = simulationTimeMs + invulnerabilityMs;
    this.collisionEnablesAtMs = collisionDelayMs === 0
      ? Number.POSITIVE_INFINITY
      : simulationTimeMs + collisionDelayMs;
    return sortDomainEvents([
      {id:"player.respawn.place", simulationTimeMs, priority:10},
      {id:"player.invulnerability.begin", simulationTimeMs, priority:10},
      ...(collisionDelayMs === 0 ? [{id:"player.collision.on", simulationTimeMs, priority:20}] : []),
    ]);
  }
}

export class ProjectileCollisionController {
  collidable = false;
  armed = false;
  cancelled = false;
  residue = false;
  private armAtMs: number;

  constructor(spawnSimulationTimeMs: number, armDelayMs: number) {
    finiteNonNegative(spawnSimulationTimeMs, "spawnSimulationTimeMs");
    finiteNonNegative(armDelayMs, "armDelayMs");
    this.armAtMs = spawnSimulationTimeMs + armDelayMs;
  }

  advanceTo(simulationTimeMs: number): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    if (this.cancelled || this.armed || simulationTimeMs < this.armAtMs) return [];
    this.armed = true;
    this.collidable = true;
    return [{id:"projectile.collision.on", simulationTimeMs:this.armAtMs, priority:20}];
  }

  cancel(simulationTimeMs: number): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    if (this.cancelled) return [];
    this.cancelled = true;
    this.armed = false;
    this.collidable = false;
    this.residue = true;
    return sortDomainEvents([
      {id:"projectile.collision.off", simulationTimeMs, priority:0},
      {id:"projectile.cancel.commit", simulationTimeMs, priority:10},
    ]);
  }

  removeResidue(simulationTimeMs: number): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    if (!this.residue) return [];
    this.residue = false;
    return [{id:"projectile.residue.remove", simulationTimeMs, priority:10}];
  }
}

export interface Vec2 {x: number; y: number}

export function sweptCircleHit(
  from: Vec2,
  to: Vec2,
  movingRadius: number,
  targetCenter: Vec2,
  targetRadius: number,
): boolean {
  finiteNonNegative(movingRadius, "movingRadius");
  finiteNonNegative(targetRadius, "targetRadius");
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((targetCenter.x - from.x) * dx + (targetCenter.y - from.y) * dy) / lengthSquared));
  const closestX = from.x + dx * t;
  const closestY = from.y + dy * t;
  const radius = movingRadius + targetRadius;
  const distanceX = targetCenter.x - closestX;
  const distanceY = targetCenter.y - closestY;
  return distanceX * distanceX + distanceY * distanceY <= radius * radius;
}

export type LaserState = "idle" | "telegraph" | "charge" | "grow" | "live" | "shutdown" | "residue";

export interface LaserDurations {
  telegraphMs: number;
  chargeMs: number;
  growMs: number;
  liveMs: number;
  shutdownMs: number;
  residueMs: number;
}

const DEFAULT_LASER_DURATIONS: LaserDurations = {
  telegraphMs: 700,
  chargeMs: 180,
  growMs: 140,
  liveMs: 900,
  shutdownMs: 180,
  residueMs: 220,
};

const LASER_NEXT: Partial<Record<LaserState, LaserState>> = {
  telegraph:"charge",
  charge:"grow",
  grow:"live",
  live:"shutdown",
  shutdown:"residue",
  residue:"idle",
};

export class BossLaserMachine {
  state: LaserState = "idle";
  collisionEnabled = false;
  clockMs = 0;
  stateElapsedMs = 0;
  cycleId = 0;
  private cancelledCycle = false;
  private stateEntryOrdinal = 0;
  readonly durations: Readonly<LaserDurations>;
  readonly instanceId: string;
  readonly maximumTransitionsPerAdvance: number;

  constructor(
    durations: Partial<LaserDurations> = {},
    instanceId = "boss-laser",
    maximumTransitionsPerAdvance = 16,
  ) {
    const merged = {...DEFAULT_LASER_DURATIONS, ...durations};
    for (const [name, value] of Object.entries(merged)) finiteNonNegative(value, name);
    if (!Number.isInteger(maximumTransitionsPerAdvance) || maximumTransitionsPerAdvance < 1) {
      throw new Error("maximumTransitionsPerAdvance must be a positive integer");
    }
    this.durations = Object.freeze(merged);
    this.instanceId = instanceId;
    this.maximumTransitionsPerAdvance = maximumTransitionsPerAdvance;
  }

  trigger(): RuntimeEvent[] {
    if (this.state !== "idle") return [];
    this.cycleId += 1;
    this.cancelledCycle = false;
    this.stateEntryOrdinal = 0;
    return this.enterState("telegraph", this.clockMs);
  }

  stop(): RuntimeEvent[] {
    if (this.state !== "live") return [];
    return this.enterState("shutdown", this.clockMs);
  }

  cancel(): RuntimeEvent[] {
    if (this.state === "idle" || this.state === "shutdown" || this.state === "residue" || this.cancelledCycle) return [];
    this.cancelledCycle = true;
    const cancelled = this.laserEvent("laser.cancelled", "gameplay", 10, this.clockMs, "state-entry", 90);
    const events = [cancelled, ...this.enterState("shutdown", this.clockMs)];
    return sortRuntimeEvents(events);
  }

  advance(deltaMs: number): RuntimeEvent[] {
    finiteNonNegative(deltaMs, "deltaMs");
    if (deltaMs === 0) return [];
    const snapshot = {
      state:this.state,
      collisionEnabled:this.collisionEnabled,
      clockMs:this.clockMs,
      stateElapsedMs:this.stateElapsedMs,
      cycleId:this.cycleId,
      cancelledCycle:this.cancelledCycle,
      stateEntryOrdinal:this.stateEntryOrdinal,
    };
    const events: RuntimeEvent[] = [];
    let remaining = deltaMs;
    let transitions = 0;
    try {
      while (remaining >= 0) {
        if (this.state === "idle") {
          this.clockMs += remaining;
          remaining = 0;
          break;
        }
        const duration = this.durationFor(this.state);
        const toBoundary = Math.max(0, duration - this.stateElapsedMs);
        if (remaining < toBoundary) {
          this.stateElapsedMs += remaining;
          this.clockMs += remaining;
          remaining = 0;
          break;
        }
        this.clockMs += toBoundary;
        remaining -= toBoundary;
        transitions += 1;
        if (transitions > this.maximumTransitionsPerAdvance) {
          throw new Error(`laser crossed more than ${this.maximumTransitionsPerAdvance} transitions`);
        }
        const next = LASER_NEXT[this.state];
        if (!next) throw new Error(`laser state ${this.state} has no timer transition`);
        if (this.state === "residue" && next === "idle") {
          events.push(this.laserEvent("laser.complete", "gameplay", 10, this.clockMs, "complete", 0));
        }
        events.push(...this.enterState(next, this.clockMs));
        if (remaining === 0) break;
      }
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
    return sortRuntimeEvents(events);
  }

  private durationFor(state: LaserState): number {
    switch (state) {
      case "telegraph": return this.durations.telegraphMs;
      case "charge": return this.durations.chargeMs;
      case "grow": return this.durations.growMs;
      case "live": return this.durations.liveMs;
      case "shutdown": return this.durations.shutdownMs;
      case "residue": return this.durations.residueMs;
      case "idle": return Number.POSITIVE_INFINITY;
    }
  }

  private enterState(next: LaserState, atMs: number): RuntimeEvent[] {
    this.state = next;
    this.stateElapsedMs = 0;
    this.stateEntryOrdinal += 1;
    const events: RuntimeEvent[] = [];
    if (next === "live") {
      this.collisionEnabled = true;
      events.push(this.laserEvent("laser.collision.on", "gameplay", 20, atMs, "state-entry", 0));
      events.push(this.laserEvent("laser.live.begin", "gameplay", 30, atMs, "state-entry", 1));
      events.push(this.laserEvent("visual.laser.body.live", "visual", 100, atMs, "state-entry", 2));
    } else {
      if (next === "shutdown" && this.collisionEnabled) {
        this.collisionEnabled = false;
        events.push(this.laserEvent("laser.collision.off", "gameplay", 0, atMs, "state-entry", 0));
      } else {
        this.collisionEnabled = false;
      }
      const stateEvents: Partial<Record<LaserState, [string, string]>> = {
        telegraph:["laser.telegraph.begin", "visual.laser.warning.show"],
        charge:["laser.charge.begin", "visual.laser.emitter.charge"],
        grow:["laser.grow.begin", "visual.laser.body.grow"],
        shutdown:["laser.shutdown.begin", "visual.laser.shutdown"],
        residue:["laser.residue.begin", "visual.laser.residue"],
      };
      const pair = stateEvents[next];
      if (pair) {
        events.push(this.laserEvent(pair[0], "gameplay", 10, atMs, "state-entry", 1));
        events.push(this.laserEvent(pair[1], "visual", 100, atMs, "state-entry", 2));
      }
    }
    return sortRuntimeEvents(events);
  }

  private laserEvent(
    id: string,
    channel: RuntimeChannel,
    priority: number,
    simulationTimeMs: number,
    kind: RuntimeEvent["kind"],
    declarationOrder: number,
  ): RuntimeEvent {
    return {
      id,
      channel,
      kind,
      priority,
      simulationTimeMs,
      elapsedMs:this.stateElapsedMs,
      timelineId:"boss-laser-v3",
      instanceId:this.instanceId,
      generation:this.cycleId,
      loopIndex:0,
      declarationOrder,
      occurrenceKey:`${this.instanceId}:${this.cycleId}:${this.state}:${this.stateEntryOrdinal}:${id}`,
      state:this.state,
      cycleId:this.cycleId,
    };
  }
}

export interface Aabb {minX: number; minY: number; maxX: number; maxY: number}

export interface StableShape {
  readonly kind: "circle" | "aabb";
  contains(point: Vec2): boolean;
  bounds(): Aabb;
}

export class CircleShape implements StableShape {
  readonly kind = "circle" as const;
  constructor(readonly center: Readonly<Vec2>, readonly radius: number) {
    finiteNonNegative(radius, "circle radius");
  }
  contains(point: Vec2): boolean {
    const dx = point.x - this.center.x;
    const dy = point.y - this.center.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }
  bounds(): Aabb {
    return {minX:this.center.x-this.radius, minY:this.center.y-this.radius, maxX:this.center.x+this.radius, maxY:this.center.y+this.radius};
  }
}

export class AabbShape implements StableShape {
  readonly kind = "aabb" as const;
  readonly box: Readonly<Aabb>;
  constructor(box: Aabb) {
    if (box.minX > box.maxX || box.minY > box.maxY) throw new Error("invalid AABB");
    this.box = Object.freeze({...box});
  }
  contains(point: Vec2): boolean {
    return point.x >= this.box.minX && point.x <= this.box.maxX && point.y >= this.box.minY && point.y <= this.box.maxY;
  }
  bounds(): Aabb { return {...this.box}; }
}

function quantize(value: number, quantum: number): number {
  return Math.round(value / quantum) * quantum;
}

function snapshotShape(shape: StableShape, quantum: number): StableShape {
  if (shape instanceof CircleShape) {
    return Object.freeze(new CircleShape(
      Object.freeze({x:quantize(shape.center.x, quantum), y:quantize(shape.center.y, quantum)}),
      quantize(shape.radius, quantum),
    ));
  }
  const box = shape.bounds();
  return Object.freeze(new AabbShape({
    minX:quantize(box.minX, quantum),
    minY:quantize(box.minY, quantum),
    maxX:quantize(box.maxX, quantum),
    maxY:quantize(box.maxY, quantum),
  }));
}

function intersectAabb(a: Aabb, b: Aabb): Aabb | null {
  const intersection = {
    minX:Math.max(a.minX, b.minX),
    minY:Math.max(a.minY, b.minY),
    maxX:Math.min(a.maxX, b.maxX),
    maxY:Math.min(a.maxY, b.maxY),
  };
  return intersection.minX <= intersection.maxX && intersection.minY <= intersection.maxY ? intersection : null;
}

export class StableIntersectionCollider {
  private primary!: StableShape;
  private secondary!: StableShape;
  private broadphase: Aabb | null = null;
  private diagnosticPending = false;
  private generation = 0;

  constructor(primary: StableShape, secondary: StableShape, readonly quantum = 1 / 256) {
    if (!Number.isFinite(quantum) || quantum <= 0) throw new Error("quantum must be greater than zero");
    this.updateGameplayPose(primary, secondary);
  }

  get collisionEnabled(): boolean { return this.broadphase !== null; }

  updateGameplayPose(primary: StableShape, secondary: StableShape): void {
    this.primary = snapshotShape(primary, this.quantum);
    this.secondary = snapshotShape(secondary, this.quantum);
    this.broadphase = intersectAabb(this.primary.bounds(), this.secondary.bounds());
    this.generation += 1;
    this.diagnosticPending = this.broadphase === null;
  }

  contains(point: Vec2): boolean {
    if (!this.broadphase) return false;
    const b = this.broadphase;
    if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) return false;
    return this.primary.contains(point) && this.secondary.contains(point);
  }

  takeDiagnostics(simulationTimeMs: number): DomainEvent[] {
    finiteNonNegative(simulationTimeMs, "simulationTimeMs");
    if (!this.diagnosticPending) return [];
    this.diagnosticPending = false;
    return [{id:`in-between.empty-intersection:${this.generation}`, simulationTimeMs, priority:10}];
  }

  /** Returns render-only poses. It deliberately does not mutate the frozen gameplay snapshots. */
  visualPoses(offset: Vec2): {primaryBounds: Aabb; secondaryBounds: Aabb} {
    const shift = (box: Aabb): Aabb => ({
      minX:box.minX+offset.x,
      minY:box.minY+offset.y,
      maxX:box.maxX+offset.x,
      maxY:box.maxY+offset.y,
    });
    return {primaryBounds:shift(this.primary.bounds()), secondaryBounds:shift(this.secondary.bounds())};
  }
}

export type BindingNodeKind = "gameplay-event" | "visual-event" | "clip" | "effect";
export type IdempotencyScope = "perEvent" | "perLoop" | "perStateEntry" | "perInstance";

export interface BindingNode {id: string; kind: BindingNodeKind; ref?: string; eventId?: string}
export interface BindingClipSegment {fromFrameId: string; toFrameId: string}
export interface BindingEdge {
  id: string;
  from: string;
  to: string;
  scope: IdempotencyScope;
  segment?: BindingClipSegment;
}
export interface BindingGraphSpec {nodes: BindingNode[]; edges: BindingEdge[]}

export interface BindingContext {
  instanceId: string;
  generation?: number;
  occurrenceId?: string;
  loopIndex?: number;
  cycleId?: number;
  state?: string;
  stateEntryOrdinal?: number;
}

export class IdempotencyLedger {
  private readonly claimed = new Set<string>();
  has(key: string): boolean { return this.claimed.has(key); }
  claim(key: string): boolean {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
  executeOnce(key: string, action: () => void): boolean {
    if (!this.claim(key)) return false;
    try {
      action();
      return true;
    } catch (error) {
      this.claimed.delete(key);
      throw error;
    }
  }
  clear(): void { this.claimed.clear(); }
  get size(): number { return this.claimed.size; }
}

export class BindingGraph {
  readonly nodes = new Map<string, BindingNode>();
  readonly edgesBySource = new Map<string, BindingEdge[]>();

  constructor(readonly spec: BindingGraphSpec, readonly ledger = new IdempotencyLedger()) {
    for (const node of spec.nodes) {
      if (this.nodes.has(node.id)) throw new Error(`duplicate binding node ${node.id}`);
      this.nodes.set(node.id, Object.freeze({...node}));
    }
    const edgeIds = new Set<string>();
    for (const edge of spec.edges) {
      if (edgeIds.has(edge.id)) throw new Error(`duplicate binding edge ${edge.id}`);
      edgeIds.add(edge.id);
      const from = this.nodes.get(edge.from);
      const to = this.nodes.get(edge.to);
      if (!from || !to) throw new Error(`binding edge ${edge.id} references a missing node`);
      if (to.kind === "gameplay-event") {
        throw new Error(`binding ${edge.id} cannot target authoritative gameplay`);
      }
      if (edge.segment && to.kind !== "clip") {
        throw new Error(`binding ${edge.id} can apply a frame segment only to a clip`);
      }
      const list = this.edgesBySource.get(edge.from) ?? [];
      list.push(Object.freeze({...edge}));
      this.edgesBySource.set(edge.from, list);
    }
    this.assertAcyclic();
    for (const edge of spec.edges) {
      const from = this.nodes.get(edge.from)!;
      const to = this.nodes.get(edge.to)!;
      if (from.kind !== "gameplay-event" || (to.kind !== "clip" && to.kind !== "effect")) {
        throw new Error(`binding ${edge.id} must be a direct gameplay-event to clip/effect edge`);
      }
    }
  }

  dispatch(sourceId: string, context: BindingContext, sink: (node: BindingNode, edge: BindingEdge) => void): string[] {
    if (!this.nodes.has(sourceId)) throw new Error(`unknown binding source ${sourceId}`);
    const executed: string[] = [];
    const queue = [sourceId];
    while (queue.length > 0) {
      const source = queue.shift()!;
      for (const edge of this.edgesBySource.get(source) ?? []) {
        const key = this.keyFor(edge, context);
        const target = this.nodes.get(edge.to)!;
        if (!this.ledger.executeOnce(key, () => sink(target, edge))) continue;
        executed.push(edge.id);
        queue.push(target.id);
      }
    }
    return executed;
  }

  private keyFor(edge: BindingEdge, context: BindingContext): string {
    const generation = context.generation ?? 0;
    switch (edge.scope) {
      case "perEvent":
        if (!context.occurrenceId) throw new Error(`edge ${edge.id} requires occurrenceId`);
        return `${edge.id}:${context.instanceId}:${generation}:${context.occurrenceId}`;
      case "perLoop":
        if (context.loopIndex === undefined) throw new Error(`edge ${edge.id} requires loopIndex`);
        return `${edge.id}:${context.instanceId}:${generation}:${context.loopIndex}`;
      case "perStateEntry":
        if (context.cycleId === undefined || context.state === undefined || context.stateEntryOrdinal === undefined) {
          throw new Error(`edge ${edge.id} requires cycleId, state and stateEntryOrdinal`);
        }
        return `${edge.id}:${context.instanceId}:${context.cycleId}:${context.state}:${context.stateEntryOrdinal}`;
      case "perInstance":
        return `${edge.id}:${context.instanceId}`;
    }
  }

  private assertAcyclic(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`binding graph contains a cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const edge of this.edgesBySource.get(id) ?? []) visit(edge.to);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.nodes.keys()) visit(id);
  }
}
