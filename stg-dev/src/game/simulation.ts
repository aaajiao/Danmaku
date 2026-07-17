import {
  EventTrace,
  PlayerDamageMachine,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/index.ts";
import {compileBurst, FIELD_HEIGHT, FIELD_WIDTH, numberParam, sampleEnvelope} from "./pattern-compiler";
import type {InputFrame} from "./input";
import type {
  BulletState,
  Difficulty,
  PatternDefinition,
  ShotState,
  SimulationEvent,
  SimulationSnapshot,
  Vec2,
} from "./types";

const PLAYER_START: Vec2 = {x: 0, y: -238};

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rotate(vector: Vec2, degrees: number): Vec2 {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {x: vector.x * cosine - vector.y * sine, y: vector.x * sine + vector.y * cosine};
}

function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return {x: vector.x / length, y: vector.y / length};
}

function angleDelta(from: Vec2, to: Vec2): number {
  const start = Math.atan2(from.y, from.x);
  const end = Math.atan2(to.y, to.x);
  return Math.atan2(Math.sin(end - start), Math.cos(end - start));
}

export class GameSimulation {
  private trace = new EventTrace();
  private damage = new PlayerDamageMachine(this.trace, {initialLives: 3}, "lab-player");
  private bullets: BulletState[] = [];
  private shots: ShotState[] = [];
  private emitterBursts = new Map<string, number>();
  private nextBulletId = 0;
  private nextShotId = 0;
  private lastShotAtMs = -Infinity;
  private nowMs = 0;
  private patternElapsedMs = 0;
  private protocol = 1;
  private overrideUntilMs = 0;
  private paused = false;
  private combatEnabled = true;
  private autoLoop = true;
  private patternCompleteEmitted = false;
  private difficulty: Difficulty = "NORMAL";
  private patternIndex = 0;
  private environmentRoom: string | null = null;
  private player = {
    position: {...PLAYER_START},
    focused: false,
    evidence: 0,
    expression: 0,
    health: 3,
    lives: 3,
    collisionEnabled: true,
  };

  constructor(
    private readonly patterns: PatternDefinition[],
    private readonly onEvent: (event: SimulationEvent) => void,
  ) {
    if (patterns.length === 0) throw new Error("At least one pattern is required");
  }

  get pattern(): PatternDefinition {
    const pattern = this.patterns[this.patternIndex];
    if (!pattern) throw new Error(`Pattern index ${this.patternIndex} is invalid`);
    return pattern;
  }

  setPattern(index: number): void {
    this.patternIndex = (index + this.patterns.length) % this.patterns.length;
    this.environmentRoom = null;
    this.resetPattern();
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.resetPattern();
  }

  configureEncounter(index: number, difficulty: Difficulty, combatEnabled: boolean, room?: string): void {
    this.patternIndex = (index + this.patterns.length) % this.patterns.length;
    this.difficulty = difficulty;
    this.combatEnabled = combatEnabled;
    this.environmentRoom = room ?? null;
    this.resetPattern();
  }

  setEnvironmentRoom(room: string): void {
    this.environmentRoom = room;
  }

  setCombatEnabled(enabled: boolean): void {
    this.combatEnabled = enabled;
    if (!enabled) this.clearCombatState();
  }

  setAutoLoop(enabled: boolean): void {
    this.autoLoop = enabled;
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.emit("pattern", this.paused ? "gameplay.clock.freeze" : "gameplay.clock.resume");
  }

  restart(): void {
    this.resetPattern();
  }

  step(dtMs: number, input: InputFrame): void {
    if (input.pausePressed) this.togglePause();
    if (this.paused) return;
    this.nowMs += dtMs;
    this.patternElapsedMs += dtMs;
    this.player.focused = input.focus;
    this.player.expression += ((input.shoot ? 1 : 0) - this.player.expression) * Math.min(1, dtMs / 120);

    this.movePlayer(input.move, dtMs);
    if (this.combatEnabled && input.shoot) this.shoot();
    if (this.combatEnabled && input.overridePressed) this.override();
    if (this.combatEnabled) {
      this.spawnPatternBursts();
      this.advanceShots(dtMs);
    }
    // Damage leases are [start, expiry): collision is authoritative again on
    // the exact expiry tick, before projectiles are evaluated.
    this.damage.advance(this.nowMs);
    this.syncDamageState();
    if (this.combatEnabled) {
      this.advanceBullets(dtMs);
      this.syncDamageState();
    }

    if (this.patternElapsedMs >= this.pattern.durationMs) {
      if (!this.patternCompleteEmitted) {
        this.patternCompleteEmitted = true;
        this.emit("pattern", `pattern.complete · ${this.pattern.id}`);
      }
      if (this.autoLoop) this.resetPattern();
      else this.patternElapsedMs = this.pattern.durationMs;
    }
  }

  snapshot(): SimulationSnapshot {
    return {
      nowMs: this.nowMs,
      patternElapsedMs: this.patternElapsedMs,
      pattern: this.pattern,
      room: this.environmentRoom ?? this.pattern.room,
      bullets: this.bullets,
      shots: this.shots,
      player: this.player,
      protocol: this.protocol,
      overrideUntilMs: this.overrideUntilMs,
      paused: this.paused,
      combatEnabled: this.combatEnabled,
    };
  }

  private movePlayer(move: Vec2, dtMs: number): void {
    const speed = this.player.focused ? 104 : 214;
    this.player.position.x = Math.max(-168, Math.min(168, this.player.position.x + move.x * speed * dtMs / 1000));
    this.player.position.y = Math.max(-300, Math.min(280, this.player.position.y + move.y * speed * dtMs / 1000));
  }

  private shoot(): void {
    const interval = this.player.focused ? 72 : 92;
    if (this.nowMs - this.lastShotAtMs < interval) return;
    this.lastShotAtMs = this.nowMs;
    const offsets = this.player.focused ? [0] : [-6, 6];
    for (const offset of offsets) {
      this.shots.push({
        id: this.nextShotId++,
        position: {x: this.player.position.x + offset, y: this.player.position.y + 12},
        previous: {x: this.player.position.x + offset, y: this.player.position.y + 12},
        velocity: {x: 0, y: 440},
      });
    }
  }

  private spawnPatternBursts(): void {
    const profile = this.pattern.difficulty[this.difficulty];
    for (const emitter of this.pattern.emitters) {
      let burstIndex = this.emitterBursts.get(emitter.id) ?? 0;
      const interval = emitter.cadence.intervalMs * profile.cadenceMultiplier;
      while (
        burstIndex < emitter.cadence.bursts
        && this.patternElapsedMs >= emitter.cadence.startMs + burstIndex * interval
      ) {
        const candidates = compileBurst(
          this.pattern,
          emitter,
          burstIndex,
          this.difficulty,
          this.player.position,
          this.patternElapsedMs,
        );
        for (const candidate of candidates) {
          this.bullets.push({
            id: this.nextBulletId++,
            archetype: candidate.archetype,
            position: {...candidate.position},
            previous: {...candidate.position},
            velocity: {...candidate.velocity},
            baseSpeed: candidate.speed,
            radius: candidate.radius,
            bornAtMs: this.nowMs,
            ageMs: 0,
            armedAtMs: this.nowMs + candidate.armDelayMs,
            grazed: false,
            generation: 0,
            splitDone: false,
            turned: new Set(),
            origin: {...candidate.position},
            motionStack: candidate.motionStack,
          });
        }
        burstIndex += 1;
        this.emitterBursts.set(emitter.id, burstIndex);
      }
    }
  }

  private advanceShots(dtMs: number): void {
    const target = this.targetPosition();
    const survivors: ShotState[] = [];
    for (const shot of this.shots) {
      shot.previous = {...shot.position};
      shot.position.x += shot.velocity.x * dtMs / 1000;
      shot.position.y += shot.velocity.y * dtMs / 1000;
      if (distance(shot.position, target) < 34) {
        this.protocol = Math.max(0, this.protocol - (this.player.focused ? 0.024 : 0.015));
        if (this.protocol <= 0) {
          this.protocol = 1;
          this.emit("protocol", "protocol.interval.observed");
        }
      } else if (shot.position.y < FIELD_HEIGHT / 2 + 30) {
        survivors.push(shot);
      }
    }
    this.shots = survivors;
  }

  private advanceBullets(dtMs: number): void {
    const survivors: BulletState[] = [];
    const children: BulletState[] = [];
    for (const bullet of this.bullets) {
      bullet.previous = {...bullet.position};
      const previousAge = bullet.ageMs;
      bullet.ageMs += dtMs;
      this.applyMotion(bullet, previousAge, dtMs, children);

      const outside = Math.abs(bullet.position.x) > FIELD_WIDTH / 2 + 70
        || Math.abs(bullet.position.y) > FIELD_HEIGHT / 2 + 70;
      if (outside) continue;

      const playerDistance = distance(bullet.position, this.player.position);
      const hitRadius = bullet.radius + (this.player.focused ? 2.4 : 3.5);
      if (this.nowMs >= bullet.armedAtMs && playerDistance <= hitRadius && this.damage.collisionEnabled) {
        const outcome = this.damage.takeDamage(1, this.nowMs, `projectile:${bullet.id}`);
        if (outcome !== "ignored") {
          this.emit("damage", `player.damage.${outcome}`);
          continue;
        }
      }
      if (!bullet.grazed && playerDistance < 18 && playerDistance > hitRadius) {
        bullet.grazed = true;
        this.player.evidence = Math.min(99, this.player.evidence + 1);
        this.trace.emit("projectile.graze.commit", this.nowMs, {
          projectileInstanceId: String(bullet.id),
          generation: bullet.generation,
          playerId: "lab-player",
        }, `graze:${bullet.id}:${bullet.generation}`);
        this.trace.emit("evidence.gain.commit", this.nowMs, {amount: 1}, `evidence:${bullet.id}`);
        this.emit("graze", `evidence +1 · projectile ${bullet.id}`);
      }
      survivors.push(bullet);
    }
    this.bullets = [...survivors, ...children];
  }

  private applyMotion(
    bullet: BulletState,
    previousAge: number,
    dtMs: number,
    children: BulletState[],
  ): void {
    let velocity = {...bullet.velocity};
    let speedFactor = 1;
    let gateFactor = 1;
    let orbiting = false;

    for (const motion of bullet.motionStack) {
      const params = motion.params;
      if (motion.operator === "op.speed_envelope") {
        const keys = Array.isArray(params.keys)
          ? params.keys.filter((key): key is {atMs: number; multiplier: number} => {
            if (!key || typeof key !== "object") return false;
            const record = key as Record<string, unknown>;
            return typeof record.atMs === "number" && typeof record.multiplier === "number";
          })
          : [];
        speedFactor *= sampleEnvelope(keys, bullet.ageMs, params.interpolation);
      } else if (motion.operator === "op.turn_once") {
        const atMs = numberParam(params, "atMs", 700);
        const key = `${motion.operator}:${atMs}`;
        if (previousAge < atMs && bullet.ageMs >= atMs && !bullet.turned.has(key)) {
          velocity = rotate(velocity, numberParam(params, "deltaDeg", 30));
          bullet.turned.add(key);
        }
      } else if (motion.operator === "op.limited_homing") {
        const endMs = numberParam(params, "endMs", 1600);
        if (bullet.ageMs <= endMs) {
          const current = normalize(velocity);
          const desired = normalize({
            x: this.player.position.x - bullet.position.x,
            y: this.player.position.y - bullet.position.y,
          });
          const maxTurn = numberParam(params, "maxDegPerSec", 32) * Math.PI / 180 * dtMs / 1000;
          const delta = Math.max(-maxTurn, Math.min(maxTurn, angleDelta(current, desired)));
          velocity = rotate(velocity, delta * 180 / Math.PI);
        }
      } else if (motion.operator === "op.local_vector_bias") {
        const vector = params.vectorPxPerSec as {x?: unknown; y?: unknown} | undefined;
        velocity.x += typeof vector?.x === "number" ? vector.x : numberParam(params, "driftPxPerSec", 0);
        velocity.y += typeof vector?.y === "number" ? -vector.y : 0;
      } else if (motion.operator === "op.dual_clock_gate") {
        const periodA = numberParam(params, "periodAMs", 600);
        const periodB = numberParam(params, "periodBMs", 900);
        const dutyA = numberParam(params, "dutyA", 0.62);
        const dutyB = numberParam(params, "dutyB", 0.48);
        const openA = bullet.ageMs % periodA < periodA * dutyA;
        const openB = bullet.ageMs % periodB < periodB * dutyB;
        gateFactor = openA || openB ? 1 : 0.08;
      } else if (motion.operator === "op.orbit_release") {
        const releaseAt = numberParam(params, "releaseAtMs", 900);
        if (bullet.ageMs < releaseAt) {
          const radius = numberParam(params, "radiusPx", 26);
          const angular = numberParam(params, "angularDegPerSec", 120);
          const angle = (bullet.ageMs / 1000 * angular + bullet.id * 17) * Math.PI / 180;
          bullet.position.x = bullet.origin.x + Math.cos(angle) * radius;
          bullet.position.y = bullet.origin.y + Math.sin(angle) * radius;
          orbiting = true;
        }
      } else if (motion.operator === "op.seam_transform") {
        const seam = numberParam(params, "seamX", 180) - FIELD_WIDTH / 2;
        const key = `${motion.operator}:${seam}`;
        const crossed = (bullet.previous.x - seam) * (bullet.position.x - seam) <= 0;
        if (crossed && bullet.ageMs > dtMs && !bullet.turned.has(key)) {
          velocity.x *= -1;
          bullet.position.x += numberParam(params, "offsetPx", 0);
          bullet.turned.add(key);
        }
      } else if (motion.operator === "op.history_replay") {
        const pulse = numberParam(params, "pulseAmount", 0.13);
        const period = numberParam(params, "pulsePeriodMs", 480);
        speedFactor *= 1 + Math.sin(bullet.ageMs / period * Math.PI * 2) * pulse;
      } else if (motion.operator === "op.split_generation") {
        const delay = numberParam(params, "delayMs", 900);
        const maxGeneration = numberParam(params, "maxGeneration", 1);
        if (!bullet.splitDone && previousAge < delay && bullet.ageMs >= delay && bullet.generation < maxGeneration) {
          bullet.splitDone = true;
          for (const degrees of [-22, 22]) {
            children.push({
              ...bullet,
              id: this.nextBulletId++,
              position: {...bullet.position},
              previous: {...bullet.position},
              velocity: rotate(velocity, degrees),
              bornAtMs: this.nowMs,
              ageMs: 0,
              armedAtMs: this.nowMs + 40,
              grazed: false,
              generation: bullet.generation + 1,
              splitDone: false,
              turned: new Set(),
              origin: {...bullet.position},
            });
          }
        }
      }
    }

    bullet.velocity = velocity;
    if (!orbiting) {
      bullet.position.x += velocity.x * speedFactor * gateFactor * dtMs / 1000;
      bullet.position.y += velocity.y * speedFactor * gateFactor * dtMs / 1000;
    }
  }

  private override(): void {
    if (this.player.evidence < 3) {
      this.emit("override-denied", "player.override.denied · evidence < 3");
      return;
    }
    this.player.evidence -= 3;
    const before = this.bullets.length;
    this.bullets = this.bullets.filter((bullet) => {
      const dx = bullet.position.x - this.player.position.x;
      const dy = bullet.position.y - this.player.position.y;
      const radius = Math.hypot(dx, dy);
      if (radius > 138 || dy < 0) return true;
      const directionAngle = Math.abs(Math.atan2(dx, dy));
      return directionAngle > 0.72;
    });
    const removed = before - this.bullets.length;
    this.overrideUntilMs = this.nowMs + 420;
    this.trace.emit("evidence.consume.commit", this.nowMs, {amount: 3}, `override-evidence:${this.nowMs}`);
    this.trace.emit("player.override.commit", this.nowMs, {removed}, `override:${this.nowMs}`);
    this.emit("override", `local_void.open · ${removed} cancelled`);
  }

  private syncDamageState(): void {
    this.player.health = this.damage.health;
    this.player.lives = this.damage.lives;
    this.player.collisionEnabled = this.damage.collisionEnabled;
    if (this.damage.state === "respawning" || this.damage.state === "dead") {
      this.player.position = {...PLAYER_START};
    }
  }

  private resetPattern(): void {
    this.patternElapsedMs = 0;
    this.patternCompleteEmitted = false;
    this.clearCombatState();
    this.protocol = 1;
    this.emit("pattern", `pattern.begin · ${this.pattern.id}`);
  }

  private clearCombatState(): void {
    this.bullets = [];
    this.shots = [];
    this.emitterBursts.clear();
  }

  private targetPosition(): Vec2 {
    if (this.pattern.category === "BOSS") return {x: 0, y: 240};
    const first = this.pattern.emitters[0];
    return first
      ? {x: first.anchor.x * FIELD_WIDTH - FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2 - first.anchor.y * FIELD_HEIGHT}
      : {x: 0, y: 230};
  }

  private emit(type: SimulationEvent["type"], detail: string): void {
    this.onEvent({type, detail, atMs: this.nowMs} as SimulationEvent);
  }
}
