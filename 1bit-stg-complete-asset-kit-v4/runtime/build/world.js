"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomTransitionMachine = exports.ROOM_TRANSITION_TIMING = exports.CrossRunRestoreMachine = exports.CROSS_RUN_RESTORE_OFFSETS = exports.CrossRunArchive = exports.SnapshotMachine = exports.SNAPSHOT_TIMING = exports.WeatherMachine = exports.BossPhaseMachine = void 0;
exports.ghostRouteDurationMs = ghostRouteDurationMs;
exports.deriveCrossRunRestoreTiming = deriveCrossRunRestoreTiming;
exports.canonicalizeRoomId = canonicalizeRoomId;
const events_js_1 = require("./events.js");
/** Supports destruction, survival, and fact-based non-combat resolutions. */
class BossPhaseMachine {
    trace;
    bossId;
    phases;
    state = "idle";
    phaseIndex = -1;
    generation = 0;
    phaseEnteredAtMs = 0;
    constructor(trace, bossId, phases) {
        this.trace = trace;
        this.bossId = bossId;
        this.phases = phases;
        if (!bossId)
            throw new Error("boss id is required");
        if (phases.length < 1)
            throw new Error("boss requires at least one phase");
        const ids = new Set();
        for (const phase of phases) {
            if (!phase.id || !phase.attackPlanId)
                throw new Error("boss phase id and attack plan are required");
            if (ids.has(phase.id))
                throw new Error(`duplicate boss phase id: ${phase.id}`);
            ids.add(phase.id);
            if (phase.exit.kind === "hp-ratio-lte" && (phase.exit.value < 0 || phase.exit.value > 1)) {
                throw new Error("boss hp ratio threshold must be in [0,1]");
            }
            if (phase.exit.kind === "survive-ms")
                (0, events_js_1.assertFiniteDuration)(phase.exit.value, "boss survival duration");
            if (phase.exit.kind === "fact" && !phase.exit.factId)
                throw new Error("boss fact exit requires factId");
        }
    }
    start(atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "boss start time");
        if (this.state === "active")
            throw new Error("boss encounter is already active");
        this.generation += 1;
        this.state = "active";
        this.phaseIndex = 0;
        this.phaseEnteredAtMs = atMs;
        this.trace.emit("boss.encounter.begin", atMs, {
            bossId: this.bossId,
            generation: this.generation,
            phaseCount: this.phases.length,
        }, this.key("encounter-begin"));
        this.emitPhaseEntry(atMs);
    }
    update(atMs, hpRatio, facts = new Set()) {
        (0, events_js_1.assertFiniteDuration)(atMs, "boss update time");
        if (!Number.isFinite(hpRatio) || hpRatio < 0 || hpRatio > 1) {
            throw new Error("boss hp ratio must be in [0,1]");
        }
        if (this.state !== "active")
            return;
        for (let traversed = 0; traversed < this.phases.length; traversed += 1) {
            const phase = this.phases[this.phaseIndex];
            if (!phase)
                throw new Error("boss phase index is invalid");
            if (!this.exitSatisfied(phase.exit, atMs, hpRatio, facts))
                return;
            this.trace.emit("boss.phase.exit", atMs, {
                bossId: this.bossId,
                generation: this.generation,
                phaseId: phase.id,
                cause: phase.exit.kind,
            }, this.key(`phase-exit:${phase.id}`));
            if (this.phaseIndex === this.phases.length - 1) {
                this.state = "resolved";
                this.trace.emit("boss.encounter.resolve", atMs, {
                    bossId: this.bossId,
                    generation: this.generation,
                    outcome: phase.exit.kind,
                    finalPhaseId: phase.id,
                }, this.key("resolve"));
                return;
            }
            const previousId = phase.id;
            this.phaseIndex += 1;
            this.phaseEnteredAtMs = atMs;
            const next = this.phases[this.phaseIndex];
            if (!next)
                throw new Error("boss next phase is missing");
            this.trace.emit("boss.phase.swap", atMs, {
                bossId: this.bossId,
                generation: this.generation,
                fromPhaseId: previousId,
                toPhaseId: next.id,
            }, this.key(`phase-swap:${next.id}`));
            this.emitPhaseEntry(atMs);
        }
        throw new Error("boss crossed more phase boundaries than declared");
    }
    exitSatisfied(exit, atMs, hpRatio, facts) {
        if (exit.kind === "hp-ratio-lte")
            return hpRatio <= exit.value;
        if (exit.kind === "survive-ms")
            return atMs - this.phaseEnteredAtMs >= exit.value;
        return facts.has(exit.factId);
    }
    emitPhaseEntry(atMs) {
        const phase = this.phases[this.phaseIndex];
        if (!phase)
            throw new Error("boss phase entry is missing");
        this.trace.emit("boss.phase.enter", atMs, {
            bossId: this.bossId,
            generation: this.generation,
            phaseId: phase.id,
            phaseIndex: this.phaseIndex,
        }, this.key(`phase-enter:${phase.id}`));
        this.trace.emit("boss.phase.attack_plan.commit", atMs, {
            bossId: this.bossId,
            generation: this.generation,
            phaseId: phase.id,
            attackPlanId: phase.attackPlanId,
        }, this.key(`attack-plan:${phase.id}`));
    }
    key(suffix) {
        return `${this.bossId}:${this.generation}:${suffix}`;
    }
}
exports.BossPhaseMachine = BossPhaseMachine;
class WeatherMachine {
    trace;
    state = "clear";
    weather;
    cycle = 0;
    deadlineMs;
    durations;
    constructor(trace) {
        this.trace = trace;
    }
    request(weather, atMs, durations) {
        (0, events_js_1.assertFiniteDuration)(atMs, "weather request time");
        if (this.state !== "clear")
            return false;
        for (const [label, value] of Object.entries(durations))
            (0, events_js_1.assertFiniteDuration)(value, `weather ${label}`);
        this.cycle += 1;
        this.weather = weather;
        this.durations = Object.freeze({ ...durations });
        this.state = "omen";
        this.deadlineMs = atMs + durations.omenMs;
        this.trace.emit("weather.omen.begin", atMs, {
            weather,
            cycle: this.cycle,
            activeAtMs: this.deadlineMs,
        }, this.key("omen"));
        if (durations.omenMs === 0)
            this.advance(atMs);
        return true;
    }
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "weather advance time");
        for (let boundary = 0; boundary < 5; boundary += 1) {
            if (!this.weather || !this.durations || this.deadlineMs === undefined || toMs < this.deadlineMs)
                return;
            const due = this.deadlineMs;
            const weather = this.weather;
            if (this.state === "omen") {
                this.state = "active";
                this.deadlineMs = due + this.durations.activeMs;
                this.trace.emit("weather.active.begin", due, { weather, cycle: this.cycle }, this.key("active"));
                continue;
            }
            if (this.state === "active") {
                this.state = "aftermath";
                this.deadlineMs = due + this.durations.aftermathMs;
                this.trace.emit("weather.aftermath.begin", due, { weather, cycle: this.cycle }, this.key("aftermath"));
                continue;
            }
            if (this.state === "aftermath") {
                this.state = "cooldown";
                this.deadlineMs = due + this.durations.cooldownMs;
                this.trace.emit("weather.cooldown.begin", due, { weather, cycle: this.cycle }, this.key("cooldown"));
                continue;
            }
            if (this.state === "cooldown") {
                this.trace.emit("weather.complete", due, { weather, cycle: this.cycle }, this.key("complete"));
                this.state = "clear";
                this.weather = undefined;
                this.durations = undefined;
                this.deadlineMs = undefined;
                return;
            }
            return;
        }
        throw new Error("weather crossed too many boundaries in one advance");
    }
    key(suffix) {
        return `weather:${this.cycle}:${suffix}`;
    }
}
exports.WeatherMachine = WeatherMachine;
function validateGhostRoute(route) {
    if (!route.routeDigest)
        throw new Error("ghost route digest is required");
    if (route.points.length < 1)
        throw new Error("cross-run restore requires a captured ghost route");
    let previous = -1;
    for (const [index, point] of route.points.entries()) {
        if (!Number.isInteger(point.tMs) || point.tMs < 0 || point.tMs <= previous) {
            if (!(index === 0 && point.tMs === 0)) {
                throw new Error("ghost route timestamps must start at zero and increase strictly");
            }
        }
        if (index === 0 && point.tMs !== 0)
            throw new Error("ghost route must begin at tMs=0");
        if (![point.xNorm, point.yNorm, point.flower].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
            throw new Error("ghost route normalized values must be in [0,1]");
        }
        if (!point.room)
            throw new Error("ghost route point room is required");
        previous = point.tMs;
    }
    return route.points[route.points.length - 1]?.tMs ?? 0;
}
function freezeMaterialRecords(records) {
    return Object.freeze(records.map((record) => Object.freeze({ ...record })));
}
function freezeSnapshotRecord(record) {
    validateGhostRoute(record.ghostRoute);
    const points = Object.freeze(record.ghostRoute.points.map((point) => Object.freeze({
        ...point,
        flags: Object.freeze([...point.flags]),
    })));
    return Object.freeze({
        ...record,
        metrics: Object.freeze({ ...record.metrics }),
        materialMemory: Object.freeze({
            overrideScars: freezeMaterialRecords(record.materialMemory.overrideScars),
            deathTraces: freezeMaterialRecords(record.materialMemory.deathTraces),
            burnIns: freezeMaterialRecords(record.materialMemory.burnIns),
            ghostResidues: freezeMaterialRecords(record.materialMemory.ghostResidues),
        }),
        ghostRoute: Object.freeze({ routeDigest: record.ghostRoute.routeDigest, points }),
    });
}
function ghostRouteDurationMs(record) {
    return validateGhostRoute(record.ghostRoute);
}
function materialCounts(memory) {
    return {
        overrideScars: memory.overrideScars.length,
        deathTraces: memory.deathTraces.length,
        burnIns: memory.burnIns.length,
        ghostResidues: memory.ghostResidues.length,
    };
}
exports.SNAPSHOT_TIMING = Object.freeze({
    serializeAtMs: 410,
    presentAtMs: 810,
    completeAtMs: 1630,
});
/** End-of-run observation. It does not perform next-run restoration. */
class SnapshotMachine {
    trace;
    state = "idle";
    serializedRecord;
    startedAtMs = 0;
    record;
    constructor(trace) {
        this.trace = trace;
    }
    begin(record, atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "snapshot start time");
        if (this.state !== "idle")
            throw new Error("snapshot already started");
        if (!record.runId || !record.snapshotHash || !record.deterministicSeed) {
            throw new Error("snapshot record is incomplete");
        }
        this.record = freezeSnapshotRecord(record);
        this.startedAtMs = atMs;
        this.state = "capturing";
        this.trace.emit("snapshot.begin", atMs, { runId: record.runId }, this.key("begin"));
    }
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "snapshot advance time");
        const record = this.record;
        if (!record)
            return;
        if (this.state === "capturing" && toMs >= this.startedAtMs + exports.SNAPSHOT_TIMING.serializeAtMs) {
            const due = this.startedAtMs + exports.SNAPSHOT_TIMING.serializeAtMs;
            this.serializedRecord = record;
            this.state = "serialized";
            this.trace.emit("snapshot.serialize.commit", due, {
                runId: record.runId,
                snapshotHash: record.snapshotHash,
                deterministicSeed: record.deterministicSeed,
                routeDigest: record.ghostRoute.routeDigest,
                routeDurationMs: ghostRouteDurationMs(record),
                materialCounts: materialCounts(record.materialMemory),
            }, this.key("serialize"));
        }
        if (this.state === "serialized" && toMs >= this.startedAtMs + exports.SNAPSHOT_TIMING.presentAtMs) {
            const due = this.startedAtMs + exports.SNAPSHOT_TIMING.presentAtMs;
            this.state = "presenting";
            this.trace.emit("snapshot.present.begin", due, {
                runId: record.runId,
                snapshotHash: record.snapshotHash,
            }, this.key("present"));
        }
        if (this.state === "presenting" && toMs >= this.startedAtMs + exports.SNAPSHOT_TIMING.completeAtMs) {
            const due = this.startedAtMs + exports.SNAPSHOT_TIMING.completeAtMs;
            this.state = "complete";
            this.trace.emit("snapshot.complete", due, { runId: record.runId }, this.key("complete"));
        }
    }
    key(suffix) {
        return `snapshot:${this.record?.runId ?? "missing"}:${suffix}`;
    }
}
exports.SnapshotMachine = SnapshotMachine;
/** Persistence is explicit and separate from both snapshot presentation and restore. */
class CrossRunArchive {
    trace;
    records = new Map();
    constructor(trace) {
        this.trace = trace;
    }
    persist(record, atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "cross-run persistence time");
        if (this.records.has(record.runId))
            throw new Error(`run is already persisted: ${record.runId}`);
        const frozen = freezeSnapshotRecord(record);
        this.records.set(record.runId, frozen);
        this.trace.emit("cross_run.record.persist.commit", atMs, {
            runId: record.runId,
            snapshotHash: record.snapshotHash,
            deterministicSeed: record.deterministicSeed,
            routeDigest: record.ghostRoute.routeDigest,
            routeDurationMs: ghostRouteDurationMs(record),
            materialCounts: materialCounts(record.materialMemory),
        }, `cross-run:persist:${record.runId}`);
    }
    get(runId) {
        return this.records.get(runId);
    }
}
exports.CrossRunArchive = CrossRunArchive;
exports.CROSS_RUN_RESTORE_OFFSETS = Object.freeze({
    materialRehydrateAtMs: 0,
    ghostReplayBeginAtMs: 420,
    ghostReplayCompleteOffsetMs: 420,
    ghostResidueWriteOffsetMs: 421,
    witnessTurnOffsetMs: 700,
    inputReturnOffsetMs: 1140,
});
function deriveCrossRunRestoreTiming(routeDurationMs) {
    (0, events_js_1.assertFiniteDuration)(routeDurationMs, "ghost route duration");
    return Object.freeze({
        materialRehydrateAtMs: exports.CROSS_RUN_RESTORE_OFFSETS.materialRehydrateAtMs,
        ghostReplayBeginAtMs: exports.CROSS_RUN_RESTORE_OFFSETS.ghostReplayBeginAtMs,
        ghostReplayCompleteAtMs: routeDurationMs + exports.CROSS_RUN_RESTORE_OFFSETS.ghostReplayCompleteOffsetMs,
        ghostResidueWriteAtMs: routeDurationMs + exports.CROSS_RUN_RESTORE_OFFSETS.ghostResidueWriteOffsetMs,
        witnessTurnAtMs: routeDurationMs + exports.CROSS_RUN_RESTORE_OFFSETS.witnessTurnOffsetMs,
        inputReturnAtMs: routeDurationMs + exports.CROSS_RUN_RESTORE_OFFSETS.inputReturnOffsetMs,
    });
}
/** Four typed materials and the actual route keep distinct semantics and clocks. */
class CrossRunRestoreMachine {
    trace;
    nextRunId;
    state = "idle";
    startedAtMs = 0;
    record;
    nextStep = 0;
    restoreTiming;
    routeDurationMs = 0;
    replayRoutePoints = [];
    finalRoutePoint;
    constructor(trace, nextRunId) {
        this.trace = trace;
        this.nextRunId = nextRunId;
        if (!nextRunId)
            throw new Error("next run id is required");
    }
    begin(record, atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "cross-run restore start time");
        if (this.state !== "idle")
            throw new Error("cross-run restore already started");
        const frozen = freezeSnapshotRecord(record);
        this.record = frozen;
        this.startedAtMs = atMs;
        this.nextStep = 0;
        this.state = "waiting-ghost";
        const routeDurationMs = ghostRouteDurationMs(frozen);
        const finalPoint = frozen.ghostRoute.points[frozen.ghostRoute.points.length - 1];
        if (!finalPoint)
            throw new Error("ghost route final point is missing");
        this.routeDurationMs = routeDurationMs;
        this.restoreTiming = deriveCrossRunRestoreTiming(routeDurationMs);
        this.finalRoutePoint = finalPoint;
        this.replayRoutePoints = Object.freeze(frozen.ghostRoute.points.map((point) => Object.freeze({
            tMs: point.tMs,
            xNorm: point.xNorm,
            yNorm: point.yNorm,
            room: point.room,
            flower: point.flower,
            focus: point.focus,
            flags: point.flags,
        })));
        this.trace.emit("player.input.off", atMs, { reason: "cross-run-restore" }, this.key("input-off"));
        this.trace.emit("cross_run.restore.begin", atMs, {
            fromRunId: frozen.runId,
            nextRunId: this.nextRunId,
            routeDigest: frozen.ghostRoute.routeDigest,
            routeDurationMs,
        }, this.key("begin"));
        this.trace.emit("overrideScar.rehydrate", atMs, {
            fromRunId: frozen.runId,
            nextRunId: this.nextRunId,
            recordType: "overrideScar",
            count: frozen.materialMemory.overrideScars.length,
            records: frozen.materialMemory.overrideScars,
        }, this.key("override-scar-rehydrate"));
        this.trace.emit("deathTrace.rehydrate", atMs, {
            fromRunId: frozen.runId,
            nextRunId: this.nextRunId,
            recordType: "deathTrace",
            count: frozen.materialMemory.deathTraces.length,
            records: frozen.materialMemory.deathTraces,
        }, this.key("death-trace-rehydrate"));
        this.trace.emit("burnIn.rehydrate", atMs, {
            fromRunId: frozen.runId,
            nextRunId: this.nextRunId,
            recordType: "burnIn",
            count: frozen.materialMemory.burnIns.length,
            records: frozen.materialMemory.burnIns,
        }, this.key("burn-in-rehydrate"));
    }
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "cross-run restore advance time");
        const record = this.record;
        if (!record || this.state === "ready")
            return;
        const timing = this.restoreTiming;
        const finalPoint = this.finalRoutePoint;
        if (!timing || !finalPoint)
            throw new Error("cross-run restore schedule is missing");
        const routeDurationMs = this.routeDurationMs;
        const routePoints = this.replayRoutePoints;
        const steps = [
            { at: timing.ghostReplayBeginAtMs, run: (due) => {
                    this.state = "replaying-ghost";
                    this.trace.emit("ghost.replay.begin", due, {
                        fromRunId: record.runId,
                        nextRunId: this.nextRunId,
                        routeDigest: record.ghostRoute.routeDigest,
                        routeDurationMs,
                        pointCount: routePoints.length,
                        routePoints,
                        timeScale: 1,
                        collisionClass: "NONE",
                        rewardClass: "NONE",
                        emitterClass: "NONE",
                    }, this.key("ghost-replay-begin"));
                } },
            { at: timing.ghostReplayCompleteAtMs, run: (due) => {
                    this.state = "materializing-residue";
                    this.trace.emit("ghost.replay.complete", due, {
                        fromRunId: record.runId,
                        nextRunId: this.nextRunId,
                        routeDigest: record.ghostRoute.routeDigest,
                        routeDurationMs,
                        finalPoint: {
                            tMs: finalPoint.tMs,
                            xNorm: finalPoint.xNorm,
                            yNorm: finalPoint.yNorm,
                            room: finalPoint.room,
                        },
                        burnAfterRead: true,
                    }, this.key("ghost-replay-complete"));
                } },
            { at: timing.ghostResidueWriteAtMs, run: (due) => {
                    this.state = "waiting-witness";
                    this.trace.emit("ghost.residue.write", due, {
                        fromRunId: record.runId,
                        nextRunId: this.nextRunId,
                        recordType: "ghostResidue",
                        residueId: `ghost-residue:${record.runId}:${this.nextRunId}`,
                        sourceRouteDigest: record.ghostRoute.routeDigest,
                        createdAfterReplay: true,
                        persistenceRuns: 1,
                        position: { room: finalPoint.room, xNorm: finalPoint.xNorm, yNorm: finalPoint.yNorm },
                        priorGhostResidueCount: record.materialMemory.ghostResidues.length,
                    }, this.key("ghost-residue-write"));
                } },
            { at: timing.witnessTurnAtMs, run: (due) => {
                    this.state = "orienting-witnesses";
                    this.trace.emit("witness.turn", due, {
                        fromRunId: record.runId,
                        nextRunId: this.nextRunId,
                        evaluatedAfterGhostResidue: true,
                        overrideScarIds: record.materialMemory.overrideScars.map((item) => String(item.id ?? "")),
                        ghostEndpoint: { room: finalPoint.room, xNorm: finalPoint.xNorm, yNorm: finalPoint.yNorm },
                        priority: ["nearbyOverrideScar", "ghostEndpoint", "resistanceTransmission", "eclipse", "resonance", "clamp", "idle"],
                    }, this.key("witness-turn"));
                } },
            { at: timing.inputReturnAtMs, run: (due) => {
                    this.state = "ready";
                    this.trace.emit("returnInput", due, {
                        fromRunId: record.runId,
                        nextRunId: this.nextRunId,
                        inputState: "enabled",
                        routeDurationMs,
                    }, this.key("return-input"));
                    this.trace.emit("cross_run.restore.complete", due, {
                        fromRunId: record.runId,
                        nextRunId: this.nextRunId,
                        routeDigest: record.ghostRoute.routeDigest,
                        routeDurationMs,
                    }, this.key("complete"));
                } },
        ];
        while (this.nextStep < steps.length) {
            const step = steps[this.nextStep];
            if (!step)
                throw new Error("cross-run restore step is missing");
            const due = this.startedAtMs + step.at;
            if (toMs < due)
                return;
            step.run(due);
            this.nextStep += 1;
        }
    }
    key(suffix) {
        return `cross-run:${this.record?.runId ?? "missing"}:${this.nextRunId}:${suffix}`;
    }
}
exports.CrossRunRestoreMachine = CrossRunRestoreMachine;
/** Input-only migration boundary; all emitted room IDs are canonical. */
function canonicalizeRoomId(value) {
    if (value === "INFO_OVERFLOW")
        return "INFORMATION";
    if (value === "INFORMATION"
        || value === "FORCED_ALIGNMENT"
        || value === "IN_BETWEEN"
        || value === "POLARIZED")
        return value;
    throw new Error(`unknown room id: ${value}`);
}
exports.ROOM_TRANSITION_TIMING = Object.freeze({
    worldSwapAtMs: 240,
    roomReadyAtMs: 500,
    completeAtMs: 650,
});
class RoomTransitionMachine {
    trace;
    state = "idle";
    currentRoom;
    targetRoom;
    startedAtMs = 0;
    generation = 0;
    constructor(trace, initialRoom) {
        this.trace = trace;
        this.currentRoom = initialRoom;
    }
    request(targetRoom, atMs) {
        (0, events_js_1.assertFiniteDuration)(atMs, "room transition request time");
        if (this.state !== "idle" || targetRoom === this.currentRoom)
            return false;
        this.generation += 1;
        this.targetRoom = targetRoom;
        this.startedAtMs = atMs;
        this.state = "preparing";
        this.trace.emit("room.transition.begin", atMs, {
            generation: this.generation,
            fromRoom: this.currentRoom,
            toRoom: targetRoom,
        }, this.key("begin"));
        return true;
    }
    advance(toMs) {
        (0, events_js_1.assertFiniteDuration)(toMs, "room transition advance time");
        const target = this.targetRoom;
        if (!target || this.state === "idle")
            return;
        if (this.state === "preparing" && toMs >= this.startedAtMs + exports.ROOM_TRANSITION_TIMING.worldSwapAtMs) {
            const due = this.startedAtMs + exports.ROOM_TRANSITION_TIMING.worldSwapAtMs;
            const from = this.currentRoom;
            this.currentRoom = target;
            this.state = "swapping";
            this.trace.emit("room.transition.world_swap.commit", due, {
                generation: this.generation,
                fromRoom: from,
                toRoom: target,
            }, this.key("world-swap"));
        }
        if (this.state === "swapping" && toMs >= this.startedAtMs + exports.ROOM_TRANSITION_TIMING.roomReadyAtMs) {
            const due = this.startedAtMs + exports.ROOM_TRANSITION_TIMING.roomReadyAtMs;
            this.state = "stabilizing";
            this.trace.emit("room.transition.room_ready", due, {
                generation: this.generation,
                room: target,
            }, this.key("room-ready"));
        }
        if (this.state === "stabilizing" && toMs >= this.startedAtMs + exports.ROOM_TRANSITION_TIMING.completeAtMs) {
            const due = this.startedAtMs + exports.ROOM_TRANSITION_TIMING.completeAtMs;
            this.trace.emit("room.transition.complete", due, {
                generation: this.generation,
                room: target,
            }, this.key("complete"));
            this.state = "idle";
            this.targetRoom = undefined;
        }
    }
    key(suffix) {
        return `room-transition:${this.generation}:${suffix}`;
    }
}
exports.RoomTransitionMachine = RoomTransitionMachine;
