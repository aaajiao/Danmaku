"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrazeAwardRegistry = exports.EvidenceLedger = exports.ProjectileLifecycle = void 0;
const events_js_1 = require("./events.js");
/**
 * Flight has no duration here. The owning entity updates movement and explicitly
 * reports impact, cancellation, or out-of-bounds removal.
 */
class ProjectileLifecycle {
    trace;
    instanceId;
    config;
    state = "dormant";
    collisionEnabled = false;
    generation = 0;
    armAtMs;
    cleanupAtMs;
    residueCause;
    constructor(trace, instanceId, config) {
        this.trace = trace;
        this.instanceId = instanceId;
        this.config = config;
        if (!instanceId)
            throw new Error("projectile instance id is required");
        (0, events_js_1.assertFiniteDuration)(config.armDelayMs, "projectile arm delay");
        (0, events_js_1.assertFiniteDuration)(config.residueMs, "projectile residue duration");
    }
    spawn(atMs, archetypeId) {
        (0, events_js_1.assertFiniteDuration)(atMs, "projectile spawn time");
        if (!archetypeId)
            throw new Error("projectile archetype id is required");
        if (this.state !== "dormant" && this.state !== "complete") {
            throw new Error(`cannot spawn projectile from ${this.state}`);
        }
        if (this.state === "complete")
            this.generation += 1;
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
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "projectile advance time");
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
    impact(atMs, targetId) {
        (0, events_js_1.assertFiniteDuration)(atMs, "projectile impact time");
        if (!targetId)
            throw new Error("impact target id is required");
        if (this.state !== "flight")
            throw new Error(`projectile cannot impact from ${this.state}`);
        this.disableCollision(atMs, "impact");
        this.trace.emit("projectile.impact.commit", atMs, {
            instanceId: this.instanceId,
            generation: this.generation,
            targetId,
        }, this.key("impact"));
        this.enterResidue(atMs, "impact");
    }
    cancel(atMs, reason) {
        (0, events_js_1.assertFiniteDuration)(atMs, "projectile cancel time");
        if (!reason)
            throw new Error("projectile cancel reason is required");
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
    enterFlight(atMs) {
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
    disableCollision(atMs, reason) {
        this.collisionEnabled = false;
        this.trace.emit("projectile.collision.off", atMs, {
            instanceId: this.instanceId,
            generation: this.generation,
            reason,
        }, this.key("collision-off"));
    }
    enterResidue(atMs, cause) {
        this.state = "residue";
        this.residueCause = cause;
        this.cleanupAtMs = atMs + this.config.residueMs;
        this.trace.emit("projectile.residue.begin", atMs, {
            instanceId: this.instanceId,
            generation: this.generation,
            cause,
            removeAtMs: this.cleanupAtMs,
        }, this.key("residue-begin"));
        if (this.config.residueMs === 0)
            this.advance(atMs);
    }
    key(suffix) {
        return `${this.instanceId}:${this.generation}:${suffix}`;
    }
}
exports.ProjectileLifecycle = ProjectileLifecycle;
class EvidenceLedger {
    trace;
    amount = 0;
    constructor(trace, initialAmount = 0) {
        this.trace = trace;
        if (!Number.isInteger(initialAmount) || initialAmount < 0) {
            throw new Error("initial evidence must be a non-negative integer");
        }
        this.amount = initialAmount;
    }
    credit(amount, atMs, sourceKey) {
        if (!Number.isInteger(amount) || amount <= 0)
            throw new Error("evidence credit must be a positive integer");
        this.amount += amount;
        this.trace.emit("evidence.gain.commit", atMs, {
            amount,
            total: this.amount,
            sourceKey,
        }, `evidence-gain:${sourceKey}`);
    }
    trySpend(amount, atMs, purposeKey) {
        if (!Number.isInteger(amount) || amount <= 0)
            throw new Error("evidence cost must be a positive integer");
        if (this.amount < amount)
            return false;
        this.amount -= amount;
        this.trace.emit("evidence.consume.commit", atMs, {
            amount,
            total: this.amount,
            purposeKey,
        }, `evidence-consume:${purposeKey}`);
        return true;
    }
}
exports.EvidenceLedger = EvidenceLedger;
/** A projectile generation can grant evidence to a player exactly once. */
class GrazeAwardRegistry {
    trace;
    ledger;
    awarded = new Set();
    constructor(trace, ledger) {
        this.trace = trace;
        this.ledger = ledger;
    }
    tryAward(projectile, playerId, atMs, amount = 1) {
        (0, events_js_1.assertFiniteDuration)(atMs, "graze time");
        if (!playerId)
            throw new Error("graze player id is required");
        if (projectile.state !== "flight" || !projectile.collisionEnabled)
            return false;
        const sourceKey = `${projectile.instanceId}:${projectile.generation}:${playerId}`;
        if (this.awarded.has(sourceKey))
            return false;
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
exports.GrazeAwardRegistry = GrazeAwardRegistry;
