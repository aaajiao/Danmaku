export const EVENT_IDS = [
  "player.collision.off",
  "player.collision.on",
  "player.damage.commit",
  "player.invulnerability.begin",
  "player.invulnerability.end",
  "player.death.commit",
  "player.life.consume",
  "player.respawn.place",
  "player.respawn.complete",
  "player.input.off",
  "run.end.commit",
  "projectile.spawn.commit",
  "projectile.arm.begin",
  "projectile.armed",
  "projectile.flight.begin",
  "projectile.collision.on",
  "projectile.collision.off",
  "projectile.impact.commit",
  "projectile.cancel.commit",
  "projectile.residue.begin",
  "projectile.residue.remove",
  "projectile.lifecycle.complete",
  "projectile.graze.commit",
  "evidence.gain.commit",
  "evidence.consume.commit",
  "gaze.acquire.begin",
  "gaze.acquire.cancel",
  "gaze.clamp.commit",
  "gaze.release.begin",
  "gaze.release.cancel",
  "gaze.clamp.release",
  "flower.intensity.commit",
  "player.override.charge.begin",
  "player.override.charge.cancel",
  "player.override.denied",
  "player.override.commit",
  "player.override.local_void.open",
  "player.override.local_void.close",
  "cross_run.scar.write.commit",
  "player.override.material_sediment.begin",
  "player.override.cooldown.begin",
  "player.override.ready",
  "boss.encounter.begin",
  "boss.phase.enter",
  "boss.phase.exit",
  "boss.phase.swap",
  "boss.phase.attack_plan.commit",
  "boss.encounter.resolve",
  "weather.omen.begin",
  "weather.active.begin",
  "weather.aftermath.begin",
  "weather.cooldown.begin",
  "weather.complete",
  "snapshot.begin",
  "snapshot.serialize.commit",
  "snapshot.present.begin",
  "snapshot.complete",
  "cross_run.record.persist.commit",
  "cross_run.restore.begin",
  "overrideScar.rehydrate",
  "deathTrace.rehydrate",
  "burnIn.rehydrate",
  "ghost.replay.begin",
  "ghost.replay.complete",
  "ghost.residue.write",
  "witness.turn",
  "returnInput",
  "cross_run.restore.complete",
  "room.transition.begin",
  "room.transition.world_swap.commit",
  "room.transition.room_ready",
  "room.transition.complete",
] as const;

export type EventId = (typeof EVENT_IDS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {readonly [key: string]: JsonValue};
export type EventPayload = Readonly<Record<string, JsonValue>>;

export interface GameplayEvent {
  readonly id: EventId;
  readonly authority: "gameplay";
  readonly simulationTimeMs: number;
  readonly sequence: number;
  readonly occurrenceKey: string;
  readonly payload: EventPayload;
}

function assertTime(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("simulation time must be finite and non-negative");
  }
}

/**
 * Append-only authoritative trace. Accessibility and rendering never receive an
 * API capable of writing to it.
 */
export class EventTrace {
  private readonly eventList: GameplayEvent[] = [];
  private nextSequence = 0;
  private readonly occurrenceKeys = new Set<string>();

  emit(
    id: EventId,
    simulationTimeMs: number,
    payload: EventPayload = {},
    occurrenceKey?: string,
  ): GameplayEvent {
    assertTime(simulationTimeMs);
    const sequence = this.nextSequence;
    const key = occurrenceKey ?? `${id}:${sequence}`;
    if (this.occurrenceKeys.has(key)) {
      throw new Error(`duplicate authoritative occurrence key: ${key}`);
    }
    this.nextSequence += 1;
    this.occurrenceKeys.add(key);
    const event: GameplayEvent = Object.freeze({
      id,
      authority: "gameplay",
      simulationTimeMs,
      sequence,
      occurrenceKey: key,
      payload: Object.freeze({...payload}),
    });
    this.eventList.push(event);
    return event;
  }

  events(): readonly GameplayEvent[] {
    return this.eventList.slice();
  }

  canonicalEvents(): readonly GameplayEvent[] {
    return this.eventList.slice().sort((a, b) =>
      a.simulationTimeMs - b.simulationTimeMs || a.sequence - b.sequence,
    );
  }

  canonicalSignature(): string {
    return JSON.stringify(this.canonicalEvents().map((event) => ({
      id: event.id,
      t: event.simulationTimeMs,
      payload: event.payload,
    })));
  }
}

export function assertFiniteDuration(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) throw new Error("value must be finite");
  return Math.max(0, Math.min(1, value));
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function normalizeVec2(value: Vec2): Vec2 {
  const length = Math.hypot(value.x, value.y);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error("direction must be finite and non-zero");
  }
  return {x: value.x / length, y: value.y / length};
}
