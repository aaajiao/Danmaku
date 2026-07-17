import {assertFiniteDuration, EventTrace} from "./events.js";

export interface CollisionLease {
  readonly token: string;
  readonly owner: string;
  readonly reason: string;
  readonly acquiredAtMs: number;
}

/** Collision is enabled only when no subsystem owns a blocker lease. */
export class CollisionLeaseSet {
  private serial = 0;
  private readonly leases = new Map<string, CollisionLease>();

  acquire(owner: string, reason: string, atMs: number): CollisionLease {
    if (!owner || !reason) throw new Error("collision lease owner and reason are required");
    assertFiniteDuration(atMs, "collision lease time");
    const token = `${owner}:${this.serial}`;
    this.serial += 1;
    const lease = Object.freeze({token, owner, reason, acquiredAtMs: atMs});
    this.leases.set(token, lease);
    return lease;
  }

  release(token: string): CollisionLease {
    const lease = this.leases.get(token);
    if (!lease) throw new Error(`unknown or already released collision lease: ${token}`);
    this.leases.delete(token);
    return lease;
  }

  get blocked(): boolean {
    return this.leases.size > 0;
  }

  activeLeases(): readonly CollisionLease[] {
    return [...this.leases.values()];
  }
}

export interface PlayerDamageConfig {
  readonly maxHealth: number;
  readonly initialLives: number;
  readonly nonFatalInvulnerabilityMs: number;
  readonly respawnPlaceMs: number;
  readonly respawnInvulnerabilityEndMs: number;
}

export type PlayerLifeState = "alive" | "dead" | "respawning" | "run-ended";
export type DamageOutcome = "ignored" | "non-fatal" | "fatal";

const DEFAULT_DAMAGE_CONFIG: PlayerDamageConfig = {
  maxHealth: 3,
  initialLives: 3,
  nonFatalInvulnerabilityMs: 1000,
  respawnPlaceMs: 1100,
  respawnInvulnerabilityEndMs: 1800,
};

/**
 * One atomic damage authority replaces competing hit and death timelines.
 * A hit chooses exactly one branch before any event is emitted.
 */
export class PlayerDamageMachine {
  readonly leases = new CollisionLeaseSet();
  readonly config: Readonly<PlayerDamageConfig>;
  state: PlayerLifeState = "alive";
  health: number;
  lives: number;

  private recoveryLeaseToken: string | undefined;
  private recoveryAtMs: number | undefined;
  private respawnPlaceAtMs: number | undefined;
  private respawnCompleteAtMs: number | undefined;

  constructor(
    private readonly trace: EventTrace,
    config: Partial<PlayerDamageConfig> = {},
    readonly instanceId = "player",
  ) {
    this.config = Object.freeze({...DEFAULT_DAMAGE_CONFIG, ...config});
    if (!Number.isInteger(this.config.maxHealth) || this.config.maxHealth < 1) {
      throw new Error("maxHealth must be a positive integer");
    }
    if (!Number.isInteger(this.config.initialLives) || this.config.initialLives < 1) {
      throw new Error("initialLives must be a positive integer");
    }
    assertFiniteDuration(this.config.nonFatalInvulnerabilityMs, "nonFatalInvulnerabilityMs");
    assertFiniteDuration(this.config.respawnPlaceMs, "respawnPlaceMs");
    assertFiniteDuration(this.config.respawnInvulnerabilityEndMs, "respawnInvulnerabilityEndMs");
    if (this.config.respawnInvulnerabilityEndMs < this.config.respawnPlaceMs) {
      throw new Error("respawn invulnerability must end after placement");
    }
    this.health = this.config.maxHealth;
    this.lives = this.config.initialLives;
  }

  get collisionEnabled(): boolean {
    return this.state === "alive" && !this.leases.blocked;
  }

  acquireCollisionBlocker(owner: string, reason: string, atMs: number): CollisionLease {
    const wasEnabled = this.collisionEnabled;
    const lease = this.leases.acquire(owner, reason, atMs);
    if (wasEnabled && !this.collisionEnabled) {
      this.trace.emit("player.collision.off", atMs, {owner, reason}, `${this.instanceId}:collision-off:${lease.token}`);
    }
    return lease;
  }

  releaseCollisionBlocker(token: string, atMs: number): void {
    const wasEnabled = this.collisionEnabled;
    const lease = this.leases.release(token);
    if (!wasEnabled && this.collisionEnabled) {
      this.trace.emit(
        "player.collision.on",
        atMs,
        {owner: lease.owner, reason: lease.reason},
        `${this.instanceId}:collision-on:${lease.token}`,
      );
    }
  }

  takeDamage(amount: number, atMs: number, sourceId: string): DamageOutcome {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("damage must be a positive integer");
    assertFiniteDuration(atMs, "damage time");
    if (!sourceId) throw new Error("damage source is required");
    if (!this.collisionEnabled) return "ignored";

    const fatal = this.health - amount <= 0;
    if (fatal) {
      this.commitFatalDamage(atMs, sourceId);
      return "fatal";
    }
    this.commitNonFatalDamage(amount, atMs, sourceId);
    return "non-fatal";
  }

  private commitNonFatalDamage(amount: number, atMs: number, sourceId: string): void {
    const lease = this.acquireCollisionBlocker("damage", "non-fatal-invulnerability", atMs);
    this.recoveryLeaseToken = lease.token;
    this.health -= amount;
    this.trace.emit("player.damage.commit", atMs, {
      amount,
      healthAfter: this.health,
      sourceId,
      branch: "non-fatal",
    }, `${this.instanceId}:damage:${atMs}`);
    this.trace.emit("player.invulnerability.begin", atMs, {
      leaseToken: lease.token,
      reason: "non-fatal",
    }, `${this.instanceId}:invulnerability-begin:${lease.token}`);
    this.recoveryAtMs = atMs + this.config.nonFatalInvulnerabilityMs;
  }

  private commitFatalDamage(atMs: number, sourceId: string): void {
    const lease = this.acquireCollisionBlocker("damage", "death-respawn", atMs);
    this.recoveryLeaseToken = lease.token;
    this.state = "dead";
    this.health = 0;
    this.lives -= 1;
    this.trace.emit("player.death.commit", atMs, {
      sourceId,
      healthAfter: 0,
      branch: "fatal",
    }, `${this.instanceId}:death:${atMs}`);
    this.trace.emit("player.life.consume", atMs, {
      livesAfter: this.lives,
    }, `${this.instanceId}:life-consume:${atMs}`);

    if (this.lives <= 0) {
      this.state = "run-ended";
      this.trace.emit("run.end.commit", atMs, {reason: "lives-exhausted"}, `${this.instanceId}:run-end:${atMs}`);
      return;
    }
    this.respawnPlaceAtMs = atMs + this.config.respawnPlaceMs;
    this.respawnCompleteAtMs = atMs + this.config.respawnInvulnerabilityEndMs;
  }

  advance(toMs: number): void {
    assertFiniteDuration(toMs, "player advance time");

    if (this.state === "alive" && this.recoveryAtMs !== undefined && toMs >= this.recoveryAtMs) {
      const due = this.recoveryAtMs;
      const token = this.recoveryLeaseToken;
      this.recoveryAtMs = undefined;
      this.recoveryLeaseToken = undefined;
      this.trace.emit("player.invulnerability.end", due, {reason: "non-fatal"}, `${this.instanceId}:invulnerability-end:${due}`);
      if (!token) throw new Error("non-fatal recovery lost its collision lease");
      this.releaseCollisionBlocker(token, due);
    }

    if (this.state === "dead" && this.respawnPlaceAtMs !== undefined && toMs >= this.respawnPlaceAtMs) {
      const due = this.respawnPlaceAtMs;
      this.respawnPlaceAtMs = undefined;
      this.state = "respawning";
      this.health = this.config.maxHealth;
      this.trace.emit("player.respawn.place", due, {health: this.health}, `${this.instanceId}:respawn-place:${due}`);
      this.trace.emit("player.invulnerability.begin", due, {
        leaseToken: this.recoveryLeaseToken ?? "",
        reason: "respawn",
      }, `${this.instanceId}:respawn-invulnerability:${due}`);
    }

    if (this.state === "respawning" && this.respawnCompleteAtMs !== undefined && toMs >= this.respawnCompleteAtMs) {
      const due = this.respawnCompleteAtMs;
      const token = this.recoveryLeaseToken;
      this.respawnCompleteAtMs = undefined;
      this.recoveryLeaseToken = undefined;
      this.trace.emit("player.invulnerability.end", due, {reason: "respawn"}, `${this.instanceId}:respawn-invulnerability-end:${due}`);
      this.state = "alive";
      if (!token) throw new Error("respawn lost its collision lease");
      this.releaseCollisionBlocker(token, due);
      this.trace.emit("player.respawn.complete", due, {}, `${this.instanceId}:respawn-complete:${due}`);
    }
  }
}
