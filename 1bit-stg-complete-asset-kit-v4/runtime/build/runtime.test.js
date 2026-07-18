"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("./index.js");
function ok(value, message) {
    if (!value)
        throw new Error(message);
}
function equal(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`${message}: expected ${b}, got ${a}`);
}
function throws(run, pattern, message) {
    let error;
    try {
        run();
    }
    catch (caught) {
        error = caught;
    }
    ok(error instanceof Error && pattern.test(error.message), message);
}
function byId(trace, id) {
    return trace.canonicalEvents().filter((event) => event.id === id);
}
function requirePreset(id) {
    const preset = index_js_1.ACCESSIBILITY_PRESETS[id];
    if (!preset)
        throw new Error(`missing accessibility preset: ${id}`);
    return preset;
}
function testPlayerDamageAuthorityAndLeases() {
    const trace = new index_js_1.EventTrace();
    const player = new index_js_1.PlayerDamageMachine(trace, {
        maxHealth: 2,
        initialLives: 2,
        nonFatalInvulnerabilityMs: 100,
        respawnPlaceMs: 120,
        respawnInvulnerabilityEndMs: 220,
    });
    const external = player.acquireCollisionBlocker("room", "atomic-world-swap", 0);
    equal(player.takeDamage(1, 1, "blocked-shot"), "ignored", "external lease blocks damage");
    player.releaseCollisionBlocker(external.token, 2);
    equal(player.takeDamage(1, 10, "shot-a"), "non-fatal", "first valid hit is non-fatal");
    equal(player.takeDamage(2, 10, "same-frame-shot"), "ignored", "lease blocks competing same-frame fatal hit");
    player.advance(110);
    equal(player.health, 1, "non-fatal damage is committed once");
    equal(player.takeDamage(2, 120, "shot-b"), "fatal", "later hit chooses fatal branch");
    equal(player.state, "dead", "fatal branch enters dead state");
    const transition = player.acquireCollisionBlocker("room", "transition-stabilization", 125);
    player.advance(1000);
    equal(player.state, "alive", "large advance traverses placement and respawn completion");
    equal(player.collisionEnabled, false, "other lease survives death lease release");
    player.releaseCollisionBlocker(transition.token, 1001);
    equal(player.collisionEnabled, true, "collision returns only after final lease releases");
    equal(byId(trace, "player.damage.commit").length, 1, "non-fatal branch emitted once");
    equal(byId(trace, "player.death.commit").length, 1, "fatal branch emitted once");
    const fatalDamageEvents = byId(trace, "player.damage.commit")
        .filter((event) => event.simulationTimeMs === 120);
    equal(fatalDamageEvents.length, 0, "fatal hit never also emits non-fatal commit");
    const atFatal = trace.events().filter((event) => event.simulationTimeMs === 120);
    ok(atFatal[0]?.id === "player.collision.off", "collision-off precedes fatal commit");
}
function testFatalRunEndHasNoRespawnRace() {
    const trace = new index_js_1.EventTrace();
    const player = new index_js_1.PlayerDamageMachine(trace, { maxHealth: 1, initialLives: 1 });
    equal(player.takeDamage(1, 50, "final-shot"), "fatal", "final life is fatal");
    player.advance(5000);
    equal(player.state, "run-ended", "run-ended state cannot be revived by stale deadline");
    equal(byId(trace, "player.respawn.place").length, 0, "no respawn is scheduled after lives exhaust");
    equal(byId(trace, "run.end.commit").length, 1, "run ends exactly once");
}
function testEntityOwnedProjectileAndGrazeOnce() {
    const trace = new index_js_1.EventTrace();
    const projectile = new index_js_1.ProjectileLifecycle(trace, "bullet-7", { armDelayMs: 90, residueMs: 220 });
    const evidence = new index_js_1.EvidenceLedger(trace);
    const graze = new index_js_1.GrazeAwardRegistry(trace, evidence);
    projectile.spawn(0, "packet-seed");
    projectile.advance(100_000);
    equal(projectile.state, "flight", "flight persists without an entity outcome");
    equal(byId(trace, "projectile.impact.commit").length, 0, "no fixed flight timer synthesizes impact");
    ok(graze.tryAward(projectile, "player", 100_010), "first graze awards evidence");
    equal(graze.tryAward(projectile, "player", 100_011), false, "same generation cannot graze twice");
    equal(evidence.amount, 1, "graze evidence is awarded exactly once");
    projectile.impact(100_020, "player");
    equal(projectile.state, "residue", "explicit impact enters material residue");
    equal(graze.tryAward(projectile, "player", 100_021), false, "residue cannot be grazed");
    projectile.advance(100_240);
    equal(projectile.state, "complete", "residue owns only cleanup timing");
    const impactIndex = trace.events().findIndex((event) => event.id === "projectile.impact.commit");
    const collisionOffIndex = trace.events().findIndex((event) => event.id === "projectile.collision.off");
    ok(collisionOffIndex >= 0 && collisionOffIndex < impactIndex, "projectile collision disables before impact commit");
    projectile.spawn(200_000, "packet-seed");
    projectile.cancel(200_010, "room-exit");
    equal(projectile.state, "residue", "arming projectile can cancel without becoming live");
    throws(() => projectile.impact(200_020, "player"), /cannot impact/, "cancelled projectile cannot also impact");
}
function testGazeSustainedClampAndDelayedRelease() {
    const trace = new index_js_1.EventTrace();
    const gaze = new index_js_1.GazeMachine(trace, { acquireMs: 500, releaseDelayMs: 300 });
    const yes = { skyEyeVisible: true, pitchDegrees: 60, alignment: 0.9 };
    const no = { skyEyeVisible: false, pitchDegrees: 0, alignment: 0 };
    gaze.observe(yes, 0);
    gaze.observe(no, 200);
    equal(gaze.state, "idle", "short accidental look does not clamp");
    gaze.observe(yes, 300);
    gaze.advance(800);
    equal(gaze.state, "clamped", "sustained gaze commits clamp");
    equal(byId(trace, "gaze.clamp.commit")[0]?.simulationTimeMs, 800, "clamp uses authoritative threshold time");
    gaze.observe(no, 900);
    gaze.observe(yes, 1000);
    equal(gaze.state, "clamped", "reacquire cancels delayed release");
    gaze.observe(no, 1100);
    gaze.advance(1400);
    equal(gaze.state, "idle", "release occurs after delay");
    equal(byId(trace, "gaze.clamp.release")[0]?.simulationTimeMs, 1400, "release time is stable");
}
function testFlowerPriority() {
    const trace = new index_js_1.EventTrace();
    const flower = new index_js_1.FlowerIntensityResolver(trace);
    equal(flower.resolve({ signalIntensity: 0.8, focusActive: false, gazeClampActive: false, overrideActive: false }, 0).source, "signal", "signal is base source");
    deepEqual(flower.resolve({ signalIntensity: 0.8, focusActive: true, gazeClampActive: false, overrideActive: false }, 1), { source: "focus", targetIntensity: 0.35 }, "focus caps signal");
    deepEqual(flower.resolve({ signalIntensity: 0.8, focusActive: true, gazeClampActive: true, overrideActive: false }, 2), { source: "gaze", targetIntensity: 0.1 }, "gaze overrides focus");
    deepEqual(flower.resolve({ signalIntensity: 0.1, focusActive: true, gazeClampActive: true, overrideActive: true }, 3), { source: "override", targetIntensity: 1 }, "override defeats clamp");
}
function testDirectionalOverrideIsLocalAndMaterial() {
    const trace = new index_js_1.EventTrace();
    const evidence = new index_js_1.EvidenceLedger(trace, 8);
    const override = new index_js_1.DirectionalOverrideMachine(trace, evidence, {
        chargeMs: 100,
        activeMs: 200,
        sedimentMs: 50,
        cooldownMs: 100,
        radius: 100,
        halfAngleDegrees: 30,
    });
    ok(override.press({ origin: { x: 10, y: 20 }, direction: { x: 1, y: 0 }, roomId: "POLARIZED" }, 0), "override charge begins");
    equal(override.contains({ x: 20, y: 20 }), false, "charging has no active void");
    override.advance(100);
    equal(override.state, "active", "evidence commits directional void");
    ok(override.contains({ x: 50, y: 20 }), "point in forward cone is affected");
    equal(override.contains({ x: -20, y: 20 }), false, "point behind player is unaffected");
    equal(override.contains({ x: 10, y: 130 }), false, "point outside radius is unaffected");
    override.advance(1000);
    equal(override.state, "idle", "large delta traverses residue and cooldown");
    equal(byId(trace, "cross_run.scar.write.commit")[0]?.payload.scarType, "overrideScar", "resistance writes a typed material scar");
    equal(byId(trace, "player.collision.off").length, 0, "override never grants global invulnerability");
}
function testBossPhaseKinds() {
    const trace = new index_js_1.EventTrace();
    const boss = new index_js_1.BossPhaseMachine(trace, "absolute-reader", [
        { id: "read", attackPlanId: "reader.scan", exit: { kind: "hp-ratio-lte", value: 0.7 } },
        { id: "hold", attackPlanId: "reader.no-dusk", exit: { kind: "survive-ms", value: 100 } },
        { id: "misread", attackPlanId: "reader.broken-reading", exit: { kind: "fact", factId: "reading-incomplete" } },
    ]);
    boss.start(0);
    boss.update(10, 0.6);
    equal(boss.phaseIndex, 1, "hp fact advances first phase");
    boss.update(109, 0.6);
    equal(boss.phaseIndex, 1, "survival phase waits full duration");
    boss.update(110, 0.6);
    equal(boss.phaseIndex, 2, "survival outcome advances second phase");
    boss.update(111, 0.6, new Set(["reading-incomplete"]));
    equal(boss.state, "resolved", "world fact resolves final phase without hp zero");
    equal(byId(trace, "boss.phase.attack_plan.commit").length, 3, "every phase owns a distinct committed plan");
    equal(byId(trace, "boss.encounter.resolve")[0]?.payload.outcome, "fact", "resolution records its fact kind");
}
function testWeatherLargeDelta() {
    const trace = new index_js_1.EventTrace();
    const weather = new index_js_1.WeatherMachine(trace);
    ok(weather.request("ECLIPSE", 100, { omenMs: 50, activeMs: 100, aftermathMs: 75, cooldownMs: 25 }), "weather starts from clear");
    weather.advance(1000);
    equal(weather.state, "clear", "large delta traverses complete weather lifecycle");
    deepEqual(["weather.active.begin", "weather.aftermath.begin", "weather.cooldown.begin", "weather.complete"].map((id) => trace.canonicalEvents().find((event) => event.id === id)?.simulationTimeMs), [150, 250, 325, 350], "weather boundaries retain exact simulation times");
}
const SAMPLE_RECORD = {
    runId: "run-0031",
    snapshotHash: "snapshot-hash-31",
    deterministicSeed: "seed-31",
    metrics: { gazeRatio: 0.42, overrideCount: 1 },
    materialMemory: {
        overrideScars: [{ id: "override-31-a", position: { room: "FORCED_ALIGNMENT", xNorm: 0.6, yNorm: 0.4 } }],
        deathTraces: [{ id: "death-31-a", position: { room: "IN_BETWEEN", xNorm: 0.4, yNorm: 0.7 } }],
        burnIns: [{ id: "burn-31-a", room: "INFORMATION", captureDigest: "burn-digest-31" }],
        ghostResidues: [{ id: "ghost-residue-30-a", sourceRouteDigest: "route-digest-30" }],
    },
    ghostRoute: {
        routeDigest: "actual-route-digest-31",
        points: [
            { tMs: 0, xNorm: 0.1, yNorm: 0.8, room: "INFORMATION", flower: 0.3, focus: false, flags: ["ROOM_ENTER"] },
            { tMs: 420, xNorm: 0.5, yNorm: 0.5, room: "IN_BETWEEN", flower: 0.5, focus: true, flags: ["GRAZE"] },
            { tMs: 960, xNorm: 0.8, yNorm: 0.2, room: "POLARIZED", flower: 0.8, focus: false, flags: ["OVERRIDE"] },
        ],
    },
};
function testSnapshotAndCrossRunAreSeparate() {
    const trace = new index_js_1.EventTrace();
    const snapshot = new index_js_1.SnapshotMachine(trace);
    snapshot.begin(SAMPLE_RECORD, 0);
    snapshot.advance(410);
    equal(byId(trace, "snapshot.serialize.commit").length, 1, "snapshot serializes at its own boundary");
    equal(trace.events().some((event) => event.id.startsWith("cross_run.")), false, "snapshot cannot silently restore or persist cross-run state");
    const archive = new index_js_1.CrossRunArchive(trace);
    const record = snapshot.serializedRecord;
    ok(record, "serialized snapshot exposes immutable persistence record");
    archive.persist(record, 410);
    snapshot.advance(2000);
    deepEqual(byId(trace, "snapshot.complete").map((event) => event.simulationTimeMs), [1630], "snapshot completion timing is authoritative");
    const restore = new index_js_1.CrossRunRestoreMachine(trace, "run-0032");
    restore.begin(record, 3000);
    restore.advance(5099);
    equal(restore.state === "ready", false, "input remains held until actual route duration plus 1140ms");
    restore.advance(5100);
    equal(restore.state, "ready", "large delta completes ordered cross-run hydration");
    const restoreEvents = trace.canonicalEvents().filter((event) => [
        "overrideScar.rehydrate",
        "deathTrace.rehydrate",
        "burnIn.rehydrate",
        "ghost.replay.begin",
        "ghost.replay.complete",
        "ghost.residue.write",
        "witness.turn",
        "returnInput",
    ].includes(event.id));
    deepEqual(restoreEvents.map((event) => [event.id, event.simulationTimeMs]), [
        ["overrideScar.rehydrate", 3000],
        ["deathTrace.rehydrate", 3000],
        ["burnIn.rehydrate", 3000],
        ["ghost.replay.begin", 3420],
        ["ghost.replay.complete", 4380],
        ["ghost.residue.write", 4381],
        ["witness.turn", 4660],
        ["returnInput", 5100],
    ], "restore follows narrative routeDuration timeline exactly");
    deepEqual(["overrideScar.rehydrate", "deathTrace.rehydrate", "burnIn.rehydrate", "ghost.residue.write"].map((id) => byId(trace, id)[0]?.payload.recordType), ["overrideScar", "deathTrace", "burnIn", "ghostResidue"], "four material memory types remain semantically separate");
    equal(byId(trace, "ghost.replay.begin")[0]?.payload.routeDurationMs, 960, "ghost begins with actual route duration");
}
function testRoomTransitionAtomicSwap() {
    const trace = new index_js_1.EventTrace();
    equal((0, index_js_1.canonicalizeRoomId)("INFO_OVERFLOW"), "INFORMATION", "legacy room id is read as a migration alias");
    const rooms = new index_js_1.RoomTransitionMachine(trace, "INFORMATION");
    ok(rooms.request("IN_BETWEEN", 100), "room transition request accepted");
    equal(rooms.request("POLARIZED", 101), false, "concurrent room transition rejected");
    equal(rooms.currentRoom, "INFORMATION", "current room stays stable during preparation");
    rooms.advance(1000);
    equal(rooms.currentRoom, "IN_BETWEEN", "world swaps exactly once");
    equal(rooms.state, "idle", "room transition completes after ready stabilization");
    equal(byId(trace, "room.transition.world_swap.commit")[0]?.simulationTimeMs, 340, "swap retains canonical boundary time");
    equal(trace.canonicalSignature().includes("INFO_OVERFLOW"), false, "runtime never writes the legacy room id");
}
function runReferenceScenario(profile) {
    const trace = new index_js_1.EventTrace();
    const gaze = new index_js_1.GazeMachine(trace, { acquireMs: 100, releaseDelayMs: 100 });
    gaze.observe({ skyEyeVisible: true, pitchDegrees: 60, alignment: 1 }, 0);
    gaze.advance(100);
    const projectile = new index_js_1.ProjectileLifecycle(trace, "scenario-bullet", { armDelayMs: 100, residueMs: 100 });
    const evidence = new index_js_1.EvidenceLedger(trace, 8);
    const graze = new index_js_1.GrazeAwardRegistry(trace, evidence);
    projectile.spawn(200, "scenario-seed");
    projectile.advance(300);
    graze.tryAward(projectile, "player", 310);
    projectile.cancel(320, "local-void");
    projectile.advance(420);
    const override = new index_js_1.DirectionalOverrideMachine(trace, evidence, {
        evidenceCost: 8,
        chargeMs: 100,
        activeMs: 100,
        sedimentMs: 100,
        cooldownMs: 100,
    });
    override.press({ origin: { x: 0, y: 0 }, direction: { x: 0, y: -1 }, roomId: "POLARIZED" }, 500);
    override.advance(1000);
    const weather = new index_js_1.WeatherMachine(trace);
    weather.request("RAIN", 1100, { omenMs: 50, activeMs: 50, aftermathMs: 50, cooldownMs: 50 });
    weather.advance(1400);
    const room = new index_js_1.RoomTransitionMachine(trace, "POLARIZED");
    room.request("FORCED_ALIGNMENT", 1500);
    room.advance(2500);
    const restore = new index_js_1.CrossRunRestoreMachine(trace, "scenario-next-run");
    restore.begin(SAMPLE_RECORD, 2600);
    restore.advance(5000);
    const router = new index_js_1.FeedbackRouter(index_js_1.REFERENCE_FEEDBACK_BINDINGS);
    const cues = trace.canonicalEvents().flatMap((event) => router.route(event, profile));
    return { trace: trace.canonicalSignature(), cueIds: cues.map((cue) => cue.cueId) };
}
function testAccessibilityGameplayTraceParity() {
    const full = runReferenceScenario(requirePreset("full"));
    const reduced = runReferenceScenario(requirePreset("reducedMotion"));
    const flashOff = runReferenceScenario(requirePreset("flashOff"));
    equal(reduced.trace, full.trace, "reduced motion has identical gameplay trace");
    equal(flashOff.trace, full.trace, "flash-off has identical gameplay trace");
    ok(full.cueIds.includes("override.directional-tear.flash"), "full profile retains override flash cue");
    ok(flashOff.cueIds.includes("override.directional-tear.steady"), "flash-off receives steady spatial fallback");
    ok(reduced.cueIds.includes("room.threshold-steady"), "reduced motion receives steady room cue");
}
function testFeedbackIsReadOnlyAndAxesAreIndependent() {
    const trace = new index_js_1.EventTrace();
    const event = trace.emit("room.transition.begin", 0, { fromRoom: "INFORMATION", toRoom: "FORCED_ALIGNMENT" });
    const router = new index_js_1.FeedbackRouter(index_js_1.REFERENCE_FEEDBACK_BINDINGS);
    const monoOnly = {
        ...requirePreset("full"),
        binaural: "mono",
    };
    const before = trace.canonicalSignature();
    const cues = router.route(event, monoOnly);
    equal(trace.canonicalSignature(), before, "feedback routing cannot write gameplay events");
    ok(cues.some((cue) => cue.cueId === "room.crossfade-mono"), "binaural axis selects mono fallback");
    ok(cues.some((cue) => cue.cueId === "room.threshold-motion"), "binaural change does not silently reduce motion");
    throws(() => new index_js_1.FeedbackRouter([{
            id: "bad-critical-flash",
            eventId: "projectile.arm.begin",
            modality: "visual",
            cueId: "flash-only",
            gameplayCritical: true,
            usesFlashing: true,
        }]), /fallback/, "critical conditional cue requires accessible fallback");
}
const TESTS = [
    ["player damage authority and collision leases", testPlayerDamageAuthorityAndLeases],
    ["fatal run end has no respawn race", testFatalRunEndHasNoRespawnRace],
    ["entity-owned projectile and graze once", testEntityOwnedProjectileAndGrazeOnce],
    ["gaze sustained clamp and delayed release", testGazeSustainedClampAndDelayedRelease],
    ["flower priority", testFlowerPriority],
    ["directional override is local and material", testDirectionalOverrideIsLocalAndMaterial],
    ["boss phase kinds", testBossPhaseKinds],
    ["weather large delta", testWeatherLargeDelta],
    ["snapshot and cross-run are separate", testSnapshotAndCrossRunAreSeparate],
    ["room transition atomic swap", testRoomTransitionAtomicSwap],
    ["accessibility gameplay trace parity", testAccessibilityGameplayTraceParity],
    ["feedback is read-only and axes independent", testFeedbackIsReadOnlyAndAxesAreIndependent],
];
for (const [name, test] of TESTS) {
    test();
    console.log(`PASS ${name}`);
}
console.log(`${TESTS.length}/${TESTS.length} V4 runtime tests passed`);
