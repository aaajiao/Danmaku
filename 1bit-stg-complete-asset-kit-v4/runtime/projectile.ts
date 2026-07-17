import {assertFiniteDuration, EventTrace} from "./events.js";

export type ProjectileState = "dormant" | "arming" | "flight" | "residue" | "complete";

export interface ProjectileLifecycleConfig {
  readonly armDelayMs: number;
  readonly residueMs: number;
}

/**
 * Flight has no duration here. The owning entity updates movement and explicitly
 * reports impact, cancellation, or out-of-bounds removal.
 */
export class ProjectileLifecycle {
  state: ProjectileState = "dormant";
  collisionEnabled = false;
  generation = 0;
  private armAtMs: number | undefined;
  private cleanupAtMs: number | undefined;
  private residueCause: "impact" | "cancel" | undefined;

  constructor(
    private readonly trace: EventTrace,
    readonly instanceId: string,
    private readonly config: Readonly<ProjectileLifecycleConfig>,
  ) {
    if (!instanceId) throw new Error("projectile instance id is required");
    assertFiniteDuration(config.armDelayMs, "projectile arm delay");
    assertFiniteDuration(config.residueMs, "projectile residue duration");
  }

  spawn(atMs: number, archetypeId: string): void {
    assertFiniteDuration(atMs, "projectile spawn time");
    if (!archetypeId) throw new Error("projectile archetype id is required");
    if (this.state !== "dormant" && this.state !== "complete") {
      throw new Error(`cannot spawn projectile from ${this.state}`);
    }
    if (this.state === "complete") this.generation += 1;
    this.state = "arming";
    this.collisionEnabled = false;
    this.cleanupAtMs = undefined;
    this.residueCause = undefined;
    this.trace.emit("projectile.spawn.commit", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
      archetypeId,
    }, this.key("spawn"));
    this.armAtMs = atMs + this.config.armDelayMs;
    this.trace.emit("projectile.arm.begin", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
      readyAtMs: this.armAtMs,
    }, this.key("arm-begin"));
    if (this.config.armDelayMs === 0) {
      this.armAtMs = undefined;
      this.enterFlight(atMs);
    }
  }

  advance(toMs: number): void {
    assertFiniteDuration(toMs, "projectile advance time");
    if (this.state === "arming" && this.armAtMs !== undefined && toMs >= this.armAtMs) {
      const due = this.armAtMs;
      this.armAtMs = undefined;
      this.enterFlight(due);
    }
    if (this.state === "residue" && this.cleanupAtMs !== undefined && toMs >= this.cleanupAtMs) {
      const due = this.cleanupAtMs;
      const cause = this.residueCause;
      this.cleanupAtMs = undefined;
      this.trace.emit("projectile.residue.remove", due, {
        instanceId: this.instanceId,
        generation: this.generation,
        cause: cause ?? "impact",
      }, this.key("residue-remove"));
      this.state = "complete";
      this.trace.emit("projectile.lifecycle.complete", due, {
        instanceId: this.instanceId,
        generation: this.generation,
        cause: cause ?? "impact",
      }, this.key("complete"));
    }
  }

  impact(atMs: number, targetId: string): void {
    assertFiniteDuration(atMs, "projectile impact time");
    if (!targetId) throw new Error("impact target id is required");
    if (this.state !== "flight") throw new Error(`projectile cannot impact from ${this.state}`);
    this.disableCollision(atMs, "impact");
    this.trace.emit("projectile.impact.commit", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
      targetId,
    }, this.key("impact"));
    this.enterResidue(atMs, "impact");
  }

  cancel(atMs: number, reason: string): void {
    assertFiniteDuration(atMs, "projectile cancel time");
    if (!reason) throw new Error("projectile cancel reason is required");
    if (this.state !== "arming" && this.state !== "flight") {
      throw new Error(`projectile cannot cancel from ${this.state}`);
    }
    this.armAtMs = undefined;
    this.disableCollision(atMs, "cancel");
    this.trace.emit("projectile.cancel.commit", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
      reason,
    }, this.key("cancel"));
    this.enterResidue(atMs, "cancel");
  }

  private enterFlight(atMs: number): void {
    this.state = "flight";
    this.trace.emit("projectile.armed", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
    }, this.key("armed"));
    this.collisionEnabled = true;
    this.trace.emit("projectile.collision.on", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
    }, this.key("collision-on"));
    this.trace.emit("projectile.flight.begin", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
      ownership: "entity",
    }, this.key("flight-begin"));
  }

  private disableCollision(atMs: number, reason: string): void {
    this.collisionEnabled = false;
    this.trace.emit("projectile.collision.off", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
      reason,
    }, this.key("collision-off"));
  }

  private enterResidue(atMs: number, cause: "impact" | "cancel"): void {
    this.state = "residue";
    this.residueCause = cause;
    this.cleanupAtMs = atMs + this.config.residueMs;
    this.trace.emit("projectile.residue.begin", atMs, {
      instanceId: this.instanceId,
      generation: this.generation,
      cause,
      removeAtMs: this.cleanupAtMs,
    }, this.key("residue-begin"));
    if (this.config.residueMs === 0) this.advance(atMs);
  }

  private key(suffix: string): string {
    return `${this.instanceId}:${this.generation}:${suffix}`;
  }
}

export class EvidenceLedger {
  amount = 0;

  constructor(private readonly trace: EventTrace, initialAmount = 0) {
    if (!Number.isInteger(initialAmount) || initialAmount < 0) {
      throw new Error("initial evidence must be a non-negative integer");
    }
    this.amount = initialAmount;
  }

  credit(amount: number, atMs: number, sourceKey: string): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("evidence credit must be a positive integer");
    this.amount += amount;
    this.trace.emit("evidence.gain.commit", atMs, {
      amount,
      total: this.amount,
      sourceKey,
    }, `evidence-gain:${sourceKey}`);
  }

  trySpend(amount: number, atMs: number, purposeKey: string): boolean {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("evidence cost must be a positive integer");
    if (this.amount < amount) return false;
    this.amount -= amount;
    this.trace.emit("evidence.consume.commit", atMs, {
      amount,
      total: this.amount,
      purposeKey,
    }, `evidence-consume:${purposeKey}`);
    return true;
  }
}

/** A projectile generation can grant evidence to a player exactly once. */
export class GrazeAwardRegistry {
  private readonly awarded = new Set<string>();

  constructor(private readonly trace: EventTrace, private readonly ledger: EvidenceLedger) {}

  tryAward(projectile: ProjectileLifecycle, playerId: string, atMs: number, amount = 1): boolean {
    assertFiniteDuration(atMs, "graze time");
    if (!playerId) throw new Error("graze player id is required");
    if (projectile.state !== "flight" || !projectile.collisionEnabled) return false;
    const sourceKey = `${projectile.instanceId}:${projectile.generation}:${playerId}`;
    if (this.awarded.has(sourceKey)) return false;
    this.awarded.add(sourceKey);
    this.trace.emit("projectile.graze.commit", atMs, {
      projectileId: projectile.instanceId,
      projectileGeneration: projectile.generation,
      playerId,
      evidence: amount,
    }, `graze:${sourceKey}`);
    this.ledger.credit(amount, atMs, `graze:${sourceKey}`);
    return true;
  }
}
