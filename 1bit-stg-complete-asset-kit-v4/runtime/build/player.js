"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerDamageMachine = exports.CollisionLeaseSet = void 0;
const events_js_1 = require("./events.js");
/** Collision is enabled only when no subsystem owns a blocker lease. */
class CollisionLeaseSet {
    serial = 0;
    leases = new Map();
    acquire(owner, reason, atMs) {
        if (!owner || !reason)
            throw new Error("collision lease owner and reason are required");
        (0, events_js_1.assertFiniteDuration)(atMs, "collision lease time");
        const token = `${owner}:${this.serial}`;
        this.serial += 1;
        const lease = Object.freeze({ token, owner, reason, acquiredAtMs: atMs });
        this.leases.set(token, lease);
        return lease;
    }
    release(token) {
        const lease = this.leases.get(token);
        if (!lease)
            throw new Error(`unknown or already released collision lease: ${token}`);
        this.leases.delete(token);
        return lease;
    }
    get blocked() {
        return this.leases.size > 0;
    }
    activeLeases() {
        return [...this.leases.values()];
    }
}
exports.CollisionLeaseSet = CollisionLeaseSet;
const DEFAULT_DAMAGE_CONFIG = {
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
class PlayerDamageMachine {
    trace;
    instanceId;
    leases = new CollisionLeaseSet();
    config;
    state = "alive";
    health;
    lives;
    recoveryLeaseToken;
    recoveryAtMs;
    respawnPlaceAtMs;
    respawnCompleteAtMs;
    constructor(trace, config = {}, instanceId = "player") {
        this.trace = trace;
        this.instanceId = instanceId;
        this.config = Object.freeze({ ...DEFAULT_DAMAGE_CONFIG, ...config });
        if (!Number.isInteger(this.config.maxHealth) || this.config.maxHealth < 1) {
            throw new Error("maxHealth must be a positive integer");
        }
        if (!Number.isInteger(this.config.initialLives) || this.config.initialLives < 1) {
            throw new Error("initialLives must be a positive integer");
        }
        (0, events_js_1.assertFiniteDuration)(this.config.nonFatalInvulnerabilityMs, "nonFatalInvulnerabilityMs");
        (0, events_js_1.assertFiniteDuration)(this.config.respawnPlaceMs, "respawnPlaceMs");
        (0, events_js_1.assertFiniteDuration)(this.config.respawnInvulnerabilityEndMs, "respawnInvulnerabilityEndMs");
        if (this.config.respawnInvulnerabilityEndMs < this.config.respawnPlaceMs) {
            throw new Error("respawn invulnerability must end after placement");
        }
        this.health = this.config.maxHealth;
        this.lives = this.config.initialLives;
    }
    get collisionEnabled() {
        return this.state === "alive" && !this.leases.blocked;
    }
    acquireCollisionBlocker(owner, reason, atMs) {
        const wasEnabled = this.collisionEnabled;
        const lease = this.leases.acquire(owner, reason, atMs);
        if (wasEnabled && !this.collisionEnabled) {
            this.trace.emit("player.collision.off", atMs, { owner, reason }, `${this.instanceId}:collision-off:${lease.token}`);
        }
        return lease;
    }
    releaseCollisionBlocker(token, atMs) {
        const wasEnabled = this.collisionEnabled;
        const lease = this.leases.release(token);
        if (!wasEnabled && this.collisionEnabled) {
            this.trace.emit("player.collision.on", atMs, { owner: lease.owner, reason: lease.reason }, `${this.instanceId}:collision-on:${lease.token}`);
        }
    }
    takeDamage(amount, atMs, sourceId) {
        if (!Number.isInteger(amount) || amount <= 0)
            throw new Error("damage must be a positive integer");
        (0, events_js_1.assertFiniteDuration)(atMs, "damage time");
        if (!sourceId)
            throw new Error("damage source is required");
        if (!this.collisionEnabled)
            return "ignored";
        const fatal = this.health - amount <= 0;
        if (fatal) {
            this.commitFatalDamage(atMs, sourceId);
            return "fatal";
        }
        this.commitNonFatalDamage(amount, atMs, sourceId);
        return "non-fatal";
    }
    commitNonFatalDamage(amount, atMs, sourceId) {
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
    commitFatalDamage(atMs, sourceId) {
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
            this.trace.emit("run.end.commit", atMs, { reason: "lives-exhausted" }, `${this.instanceId}:run-end:${atMs}`);
            return;
        }
        this.respawnPlaceAtMs = atMs + this.config.respawnPlaceMs;
        this.respawnCompleteAtMs = atMs + this.config.respawnInvulnerabilityEndMs;
    }
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "player advance time");
        if (this.state === "alive" && this.recoveryAtMs !== undefined && toMs >= this.recoveryAtMs) {
            const due = this.recoveryAtMs;
            const token = this.recoveryLeaseToken;
            this.recoveryAtMs = undefined;
            this.recoveryLeaseToken = undefined;
            this.trace.emit("player.invulnerability.end", due, { reason: "non-fatal" }, `${this.instanceId}:invulnerability-end:${due}`);
            if (!token)
                throw new Error("non-fatal recovery lost its collision lease");
            this.releaseCollisionBlocker(token, due);
        }
        if (this.state === "dead" && this.respawnPlaceAtMs !== undefined && toMs >= this.respawnPlaceAtMs) {
            const due = this.respawnPlaceAtMs;
            this.respawnPlaceAtMs = undefined;
            this.state = "respawning";
            this.health = this.config.maxHealth;
            this.trace.emit("player.respawn.place", due, { health: this.health }, `${this.instanceId}:respawn-place:${due}`);
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
            this.trace.emit("player.invulnerability.end", due, { reason: "respawn" }, `${this.instanceId}:respawn-invulnerability-end:${due}`);
            this.state = "alive";
            if (!token)
                throw new Error("respawn lost its collision lease");
            this.releaseCollisionBlocker(token, due);
            this.trace.emit("player.respawn.complete", due, {}, `${this.instanceId}:respawn-complete:${due}`);
        }
    }
}
exports.PlayerDamageMachine = PlayerDamageMachine;
