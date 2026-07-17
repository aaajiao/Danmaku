"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectionalOverrideMachine = exports.FlowerIntensityResolver = exports.GazeMachine = void 0;
const events_js_1 = require("./events.js");
const DEFAULT_GAZE_CONFIG = {
    pitchThresholdDegrees: 45,
    alignmentThreshold: 0.72,
    acquireMs: 500,
    releaseDelayMs: 450,
};
/** Sky Eye reading is a sustained relation, not a per-frame boolean. */
class GazeMachine {
    trace;
    config;
    state = "idle";
    deadlineMs;
    cycle = 0;
    releaseAttempt = 0;
    constructor(trace, config = {}) {
        this.trace = trace;
        this.config = Object.freeze({ ...DEFAULT_GAZE_CONFIG, ...config });
        (0, events_js_1.assertFiniteDuration)(this.config.acquireMs, "gaze acquire duration");
        (0, events_js_1.assertFiniteDuration)(this.config.releaseDelayMs, "gaze release delay");
        if (this.config.pitchThresholdDegrees < -90 || this.config.pitchThresholdDegrees > 90) {
            throw new Error("gaze pitch threshold must be between -90 and 90 degrees");
        }
        if (this.config.alignmentThreshold < 0 || this.config.alignmentThreshold > 1) {
            throw new Error("gaze alignment threshold must be in [0,1]");
        }
    }
    get clampActive() {
        return this.state === "clamped" || this.state === "release-delay";
    }
    observe(sample, atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "gaze sample time");
        if (!Number.isFinite(sample.pitchDegrees))
            throw new Error("gaze pitch must be finite");
        const alignment = (0, events_js_1.clamp01)(sample.alignment);
        this.advance(atMs);
        const qualifies = sample.skyEyeVisible
            && sample.pitchDegrees >= this.config.pitchThresholdDegrees
            && alignment >= this.config.alignmentThreshold;
        if (this.state === "idle" && qualifies) {
            this.cycle += 1;
            this.releaseAttempt = 0;
            this.state = "acquiring";
            this.deadlineMs = atMs + this.config.acquireMs;
            this.trace.emit("gaze.acquire.begin", atMs, {
                cycle: this.cycle,
                clampAtMs: this.deadlineMs,
            }, `gaze:${this.cycle}:acquire`);
            if (this.config.acquireMs === 0)
                this.advance(atMs);
            return;
        }
        if (this.state === "acquiring" && !qualifies) {
            this.state = "idle";
            this.deadlineMs = undefined;
            this.trace.emit("gaze.acquire.cancel", atMs, { cycle: this.cycle }, `gaze:${this.cycle}:acquire-cancel`);
            return;
        }
        if (this.state === "clamped" && !qualifies) {
            this.releaseAttempt += 1;
            this.state = "release-delay";
            this.deadlineMs = atMs + this.config.releaseDelayMs;
            this.trace.emit("gaze.release.begin", atMs, {
                cycle: this.cycle,
                releaseAtMs: this.deadlineMs,
            }, `gaze:${this.cycle}:release-begin:${this.releaseAttempt}`);
            if (this.config.releaseDelayMs === 0)
                this.advance(atMs);
            return;
        }
        if (this.state === "release-delay" && qualifies) {
            this.state = "clamped";
            this.deadlineMs = undefined;
            this.trace.emit("gaze.release.cancel", atMs, {
                cycle: this.cycle,
                releaseAttempt: this.releaseAttempt,
            }, `gaze:${this.cycle}:release-cancel:${this.releaseAttempt}`);
        }
    }
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "gaze advance time");
        if (this.state === "acquiring" && this.deadlineMs !== undefined && toMs >= this.deadlineMs) {
            const due = this.deadlineMs;
            this.deadlineMs = undefined;
            this.state = "clamped";
            this.trace.emit("gaze.clamp.commit", due, {
                cycle: this.cycle,
                forcedIntensity: 0.1,
            }, `gaze:${this.cycle}:clamp`);
        }
        if (this.state === "release-delay" && this.deadlineMs !== undefined && toMs >= this.deadlineMs) {
            const due = this.deadlineMs;
            this.deadlineMs = undefined;
            this.state = "idle";
            this.trace.emit("gaze.clamp.release", due, {
                cycle: this.cycle,
                releaseAttempt: this.releaseAttempt,
            }, `gaze:${this.cycle}:release:${this.releaseAttempt}`);
        }
    }
}
exports.GazeMachine = GazeMachine;
/** Priority is contractual: Override > Gaze > Focus > player signal. */
class FlowerIntensityResolver {
    trace;
    gazeIntensity;
    focusCap;
    previous;
    occurrence = 0;
    constructor(trace, gazeIntensity = 0.1, focusCap = 0.35) {
        this.trace = trace;
        this.gazeIntensity = gazeIntensity;
        this.focusCap = focusCap;
    }
    resolve(inputs, atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "flower resolve time");
        const signal = (0, events_js_1.clamp01)(inputs.signalIntensity);
        let resolution;
        if (inputs.overrideActive) {
            resolution = { source: "override", targetIntensity: 1 };
        }
        else if (inputs.gazeClampActive) {
            resolution = { source: "gaze", targetIntensity: (0, events_js_1.clamp01)(this.gazeIntensity) };
        }
        else if (inputs.focusActive) {
            resolution = { source: "focus", targetIntensity: Math.min(signal, (0, events_js_1.clamp01)(this.focusCap)) };
        }
        else {
            resolution = { source: "signal", targetIntensity: signal };
        }
        const frozen = Object.freeze(resolution);
        if (!this.previous
            || this.previous.source !== frozen.source
            || this.previous.targetIntensity !== frozen.targetIntensity) {
            this.occurrence += 1;
            this.trace.emit("flower.intensity.commit", atMs, {
                source: frozen.source,
                targetIntensity: frozen.targetIntensity,
            }, `flower:${this.occurrence}`);
            this.previous = frozen;
        }
        return frozen;
    }
}
exports.FlowerIntensityResolver = FlowerIntensityResolver;
const DEFAULT_OVERRIDE_CONFIG = {
    evidenceCost: 8,
    chargeMs: 600,
    activeMs: 700,
    sedimentMs: 520,
    cooldownMs: 800,
    radius: 180,
    halfAngleDegrees: 24,
};
/** Directional local rule tear. It never grants global player invulnerability. */
class DirectionalOverrideMachine {
    trace;
    evidence;
    config;
    state = "idle";
    localVoid;
    context;
    deadlineMs;
    cycle = 0;
    constructor(trace, evidence, config = {}) {
        this.trace = trace;
        this.evidence = evidence;
        this.config = Object.freeze({ ...DEFAULT_OVERRIDE_CONFIG, ...config });
        if (!Number.isInteger(this.config.evidenceCost) || this.config.evidenceCost <= 0) {
            throw new Error("override evidence cost must be a positive integer");
        }
        for (const [label, value] of Object.entries({
            chargeMs: this.config.chargeMs,
            activeMs: this.config.activeMs,
            sedimentMs: this.config.sedimentMs,
            cooldownMs: this.config.cooldownMs,
            radius: this.config.radius,
        }))
            (0, events_js_1.assertFiniteDuration)(value, label);
        if (this.config.radius <= 0)
            throw new Error("override radius must be positive");
        if (this.config.halfAngleDegrees <= 0 || this.config.halfAngleDegrees >= 90) {
            throw new Error("override half angle must be in (0,90)");
        }
    }
    press(context, atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "override press time");
        if (this.state !== "idle")
            return false;
        if (!context.roomId)
            throw new Error("override room id is required");
        const normalized = {
            origin: { x: context.origin.x, y: context.origin.y },
            direction: (0, events_js_1.normalizeVec2)(context.direction),
            roomId: context.roomId,
        };
        this.cycle += 1;
        this.context = normalized;
        this.state = "charging";
        this.deadlineMs = atMs + this.config.chargeMs;
        this.trace.emit("player.override.charge.begin", atMs, {
            cycle: this.cycle,
            roomId: normalized.roomId,
            commitAtMs: this.deadlineMs,
            evidenceCost: this.config.evidenceCost,
        }, this.key("charge-begin"));
        if (this.config.chargeMs === 0)
            this.advance(atMs);
        return true;
    }
    release(atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "override release time");
        if (this.state !== "charging")
            return false;
        this.state = "idle";
        this.deadlineMs = undefined;
        this.context = undefined;
        this.trace.emit("player.override.charge.cancel", atMs, { cycle: this.cycle }, this.key("charge-cancel"));
        return true;
    }
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "override advance time");
        for (let boundary = 0; boundary < 5; boundary += 1) {
            if (this.deadlineMs === undefined || toMs < this.deadlineMs)
                return;
            const due = this.deadlineMs;
            if (this.state === "charging") {
                const context = this.context;
                if (!context)
                    throw new Error("override charge lost its context");
                if (!this.evidence.trySpend(this.config.evidenceCost, due, `override:${this.cycle}`)) {
                    this.trace.emit("player.override.denied", due, {
                        cycle: this.cycle,
                        reason: "insufficient-evidence",
                    }, this.key("denied"));
                    this.state = "idle";
                    this.deadlineMs = undefined;
                    this.context = undefined;
                    return;
                }
                this.state = "active";
                this.deadlineMs = due + this.config.activeMs;
                this.localVoid = Object.freeze({
                    origin: context.origin,
                    direction: context.direction,
                    radius: this.config.radius,
                    halfAngleDegrees: this.config.halfAngleDegrees,
                    openedAtMs: due,
                    closesAtMs: this.deadlineMs,
                });
                this.trace.emit("player.override.commit", due, {
                    cycle: this.cycle,
                    roomId: context.roomId,
                    mode: "directional-local",
                }, this.key("commit"));
                this.trace.emit("player.override.local_void.open", due, {
                    cycle: this.cycle,
                    originX: context.origin.x,
                    originY: context.origin.y,
                    directionX: context.direction.x,
                    directionY: context.direction.y,
                    radius: this.config.radius,
                    halfAngleDegrees: this.config.halfAngleDegrees,
                }, this.key("void-open"));
                continue;
            }
            if (this.state === "active") {
                const context = this.context;
                if (!context)
                    throw new Error("active override lost its context");
                this.trace.emit("player.override.local_void.close", due, { cycle: this.cycle }, this.key("void-close"));
                this.trace.emit("cross_run.scar.write.commit", due, {
                    cycle: this.cycle,
                    scarType: "overrideScar",
                    roomId: context.roomId,
                    x: context.origin.x,
                    y: context.origin.y,
                    directionX: context.direction.x,
                    directionY: context.direction.y,
                }, this.key("scar-write"));
                this.localVoid = undefined;
                this.state = "sediment";
                this.deadlineMs = due + this.config.sedimentMs;
                this.trace.emit("player.override.material_sediment.begin", due, {
                    cycle: this.cycle,
                    scarType: "overrideScar",
                }, this.key("sediment"));
                continue;
            }
            if (this.state === "sediment") {
                this.state = "cooldown";
                this.deadlineMs = due + this.config.cooldownMs;
                this.trace.emit("player.override.cooldown.begin", due, { cycle: this.cycle }, this.key("cooldown"));
                continue;
            }
            if (this.state === "cooldown") {
                this.state = "idle";
                this.deadlineMs = undefined;
                this.context = undefined;
                this.trace.emit("player.override.ready", due, { cycle: this.cycle }, this.key("ready"));
                return;
            }
            return;
        }
        throw new Error("override crossed too many state boundaries in one advance");
    }
    contains(point) {
        const area = this.localVoid;
        if (this.state !== "active" || !area)
            return false;
        const dx = point.x - area.origin.x;
        const dy = point.y - area.origin.y;
        const distance = Math.hypot(dx, dy);
        if (distance > area.radius)
            return false;
        if (distance === 0)
            return true;
        const dot = (dx / distance) * area.direction.x + (dy / distance) * area.direction.y;
        return dot >= Math.cos(area.halfAngleDegrees * Math.PI / 180);
    }
    key(suffix) {
        return `override:${this.cycle}:${suffix}`;
    }
}
exports.DirectionalOverrideMachine = DirectionalOverrideMachine;
