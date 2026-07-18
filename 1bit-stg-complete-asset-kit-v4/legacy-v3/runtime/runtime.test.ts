import {
  AabbShape,
  BindingGraph,
  BossLaserMachine,
  CircleShape,
  DualTimeline,
  EventTimeline,
  PlayerCollisionController,
  ProjectileCollisionController,
  StableIntersectionCollider,
  VisualTrack,
  sweptCircleHit,
} from "./runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: expected ${b}, got ${a}`);
}

function throws(fn: () => void, pattern: RegExp, message: string): void {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error && pattern.test(error.message), `${message}: wrong error`);
    return;
  }
  throw new Error(`${message}: did not throw`);
}

function testLargeDeltaTimeline(): void {
  const timeline = new EventTimeline({
    id:"large-delta",
    durationMs:100,
    events:[
      {id:"zero", atMs:0, priority:10},
      {id:"disable", atMs:50, priority:0},
      {id:"commit", atMs:50, priority:10},
      {id:"end", atMs:100, priority:10},
    ],
    completionEvent:"complete",
    completionPriority:90,
    cancelEvent:"cancelled",
    cancelPriority:10,
  }, "timeline-1");
  deepEqual(timeline.start(1000).map((event) => event.id), ["zero"], "start emits t=0");
  const crossed = timeline.advance(100);
  deepEqual(crossed.map((event) => event.id), ["disable", "commit", "end", "complete"], "large delta emits all events in order");
  deepEqual(crossed.map((event) => event.simulationTimeMs), [1050, 1050, 1100, 1100], "event timestamps stay exact");
  deepEqual(crossed.map((event) => event.priority), [0, 10, 10, 90], "completion follows authoritative boundary events");
  equal(timeline.status, "completed", "timeline completes");
  equal(timeline.advance(999).length, 0, "completion is emitted once");

  const cancelled = new EventTimeline({
    id:"cancel",
    durationMs:100,
    events:[{id:"late",atMs:100}],
    completionEvent:"complete",
    cancelEvent:"cancelled",
  });
  cancelled.start();
  cancelled.advance(20);
  const cancelEvents = cancelled.cancel();
  deepEqual(cancelEvents.map((event) => event.id), ["cancelled"], "gameplay cancel emits once");
  equal(cancelEvents[0].priority, 10, "cancel is a state commit, not a collision-disable event");
  equal(cancelled.cancel().length, 0, "gameplay cancel is idempotent");
  equal(cancelled.advance(1000).length, 0, "cancelled gameplay timeline never completes");
}

function testLoopResetAndOverflow(): void {
  const timeline = new EventTimeline({
    id:"loop",
    durationMs:200,
    loop:true,
    events:[{id:"pulse", atMs:50}],
  }, "loop-1");
  timeline.start();
  const events = timeline.advance(450);
  deepEqual(events.map((event) => [event.id, event.loopIndex, event.simulationTimeMs]), [
    ["pulse", 0, 50],
    ["pulse", 1, 250],
    ["pulse", 2, 450],
  ], "loop events reset per loop");
  equal(new Set(events.map((event) => event.occurrenceKey)).size, 3, "loop occurrence keys are unique");

  const finiteLoop = new EventTimeline({
    id:"finite-loop",
    durationMs:100,
    loop:true,
    maxLoops:2,
    events:[{id:"begin",atMs:0}],
    completionEvent:"done",
  });
  finiteLoop.start();
  const finiteEvents = finiteLoop.advance(200);
  equal(finiteEvents.filter((event) => event.id === "done").length, 1, "finite loop completes after final loop only");
  equal(finiteEvents.find((event) => event.id === "done")?.loopIndex, 1, "completion belongs to final loop");

  const guarded = new EventTimeline({
    id:"guarded",
    durationMs:1,
    loop:true,
    maximumBoundariesPerAdvance:2,
    events:[],
  });
  guarded.start();
  throws(() => guarded.advance(3), /more than 2/, "large delta overflow is explicit");
  equal(guarded.elapsedMs, 0, "overflow does not advance gameplay state");
}

function testVisualHoldCompletionAndCancel(): void {
  const track = new VisualTrack({
    id:"hold",
    frames:[{id:"a", durationMs:100}, {id:"b-hold", durationMs:300}],
    reducedMotionFrame:"b-hold",
  });
  deepEqual(track.start().map((signal) => signal.frameId), ["a"], "visual starts at first frame");
  equal(track.advance(99).length, 0, "hold does not end early");
  deepEqual(track.advance(1).map((signal) => signal.frameId), ["b-hold"], "frame boundary is inclusive");
  equal(track.cancel().length, 1, "cancel emits once");
  equal(track.cancel().length, 0, "cancel is idempotent");
  equal(track.advance(1000).length, 0, "cancelled track never completes");

  const completing = new VisualTrack({
    id:"complete",
    frames:[{id:"first", durationMs:20}, {id:"last", durationMs:80}],
    reducedMotionFrame:"last",
  });
  completing.start();
  const signals = completing.advance(1000);
  equal(signals.filter((signal) => signal.kind === "complete").length, 1, "visual completion emits once");
  equal(signals.at(-1)?.frameId, "last", "completion retains final frame");
  equal(completing.advance(1).length, 0, "visual completion remains idempotent");
}

function gameplayTrace(profile: "full" | "reduced-motion"): [string, number, number][] {
  const dual = new DualTimeline(
    new EventTimeline({
      id:"player.focus",
      durationMs:1040,
      events:[
        {id:"player.focus.begin", atMs:0, priority:10},
        {id:"player.hitbox.focus.on", atMs:0, priority:10},
        {id:"player.focus.hold", atMs:360, priority:10},
        {id:"player.focus.confirm", atMs:730, priority:10},
      ],
      completionEvent:"player.focus.complete",
      completionPriority:90,
    }, `player-focus-${profile}`),
    new VisualTrack({
      id:"player.focus",
      frames:[
        {id:"player.focus.frame_00", durationMs:90},
        {id:"player.focus.frame_01", durationMs:90},
        {id:"player.focus.frame_02", durationMs:180},
        {id:"player.focus.frame_03", durationMs:240},
        {id:"player.focus.frame_04", durationMs:70},
        {id:"player.focus.frame_05", durationMs:60},
        {id:"player.focus.frame_06", durationMs:130},
        {id:"player.focus.frame_07", durationMs:180},
      ],
      reducedMotionFrame:"player.focus.frame_06",
    }, profile),
  );
  const started = dual.start(4000);
  const advanced = dual.advance(2000);
  return [...started.gameplay, ...advanced.gameplay].map((event) => [event.id, event.simulationTimeMs, event.priority]);
}

function testReducedMotionEquivalence(): void {
  deepEqual(gameplayTrace("full"), gameplayTrace("reduced-motion"), "visual profile cannot change gameplay trace");
}

function testV3AlignedActionSeparation(): void {
  const cancelAction = new DualTimeline(
    new EventTimeline({
      id:"projectile.cancel",
      durationMs:340,
      events:[
        {id:"projectile.collision.off",atMs:0,priority:0},
        {id:"projectile.cancel.commit",atMs:0,priority:10},
        {id:"projectile.cancel.residue.begin",atMs:120,priority:10},
        {id:"projectile.residue.remove",atMs:340,priority:10},
      ],
      completionEvent:"projectile.cancel.complete",
      completionPriority:90,
    }),
    new VisualTrack({
      id:"bullet.cancel",
      frames:[
        {id:"bullet.impact_0",durationMs:50},
        {id:"bullet.impact_1",durationMs:70},
      ],
      reducedMotionFrame:"bullet.impact_1",
    }),
  );
  const started = cancelAction.start(5000);
  deepEqual(started.gameplay.map((event) => event.id), ["projectile.collision.off", "projectile.cancel.commit"], "v3 cancel disables collision before impact clip");
  const impactFinished = cancelAction.advance(120);
  equal(impactFinished.visual.at(-1)?.kind, "complete", "two-frame bullet.cancel visual completes at 120ms");
  deepEqual(impactFinished.gameplay.map((event) => event.id), ["projectile.cancel.residue.begin"], "residue begins independently at the visual boundary");
  equal(cancelAction.gameplay.status, "running", "visual completion cannot complete gameplay cleanup");
  const cleanupFinished = cancelAction.advance(220);
  deepEqual(cleanupFinished.gameplay.map((event) => event.id), ["projectile.residue.remove", "projectile.cancel.complete"], "full residue cleanup continues through 340ms");

  const override = new EventTimeline({
    id:"player.override.directional",
    durationMs:1250,
    events:[
      {id:"player.override.begin",atMs:0,priority:10},
      {id:"player.collision.off",atMs:380,priority:0},
      {id:"player.override.commit",atMs:380,priority:10},
      {id:"cross_run.scar.write.commit",atMs:500,priority:10},
      {id:"player.collision.on",atMs:1250,priority:20},
    ],
    completionEvent:"player.override.complete",
    completionPriority:90,
  });
  override.start();
  const overrideEvents = override.advance(1250);
  const atCommit = overrideEvents.filter((event) => event.simulationTimeMs === 380).map((event) => event.id);
  deepEqual(atCommit, ["player.collision.off", "player.override.commit"], "override collision turns off before commit");
  deepEqual(overrideEvents.slice(-2).map((event) => event.id), ["player.collision.on", "player.override.complete"], "override collision restores before completion");

  const snapshot = new EventTimeline({
    id:"cross-run.snapshot",
    durationMs:1630,
    events:[
      {id:"cross_run.snapshot.begin",atMs:0,priority:10},
      {id:"cross_run.snapshot.serialize.commit",atMs:410,priority:10},
      {id:"cross_run.next-run.seed.commit",atMs:810,priority:10},
      {id:"cross_run.scar.restore.commit",atMs:970,priority:10},
    ],
    completionEvent:"cross_run.snapshot.complete",
    completionPriority:90,
  });
  const snapshotTrace = [...snapshot.start(10000), ...snapshot.advance(5000)];
  deepEqual(snapshotTrace.map((event) => [event.id,event.simulationTimeMs]), [
    ["cross_run.snapshot.begin",10000],
    ["cross_run.snapshot.serialize.commit",10410],
    ["cross_run.next-run.seed.commit",10810],
    ["cross_run.scar.restore.commit",10970],
    ["cross_run.snapshot.complete",11630],
  ], "cross-run persistence commits remain on the gameplay clock");
}

function testPlayerTiming(): void {
  const player = new PlayerCollisionController();
  const hit = player.hit(100, 1000);
  deepEqual(hit.map((event) => event.id), ["player.collision.off", "player.damage.commit", "player.invulnerability.begin"], "player collision disables before damage");
  assert(!player.collidable && player.invulnerable, "hit state is immediate");
  equal(player.advanceTo(1099).length, 0, "player cannot re-enable early");
  const recovered = player.advanceTo(9000);
  deepEqual(recovered.map((event) => [event.id, event.simulationTimeMs]), [
    ["player.invulnerability.end", 1100],
    ["player.collision.on", 1100],
  ], "large delta preserves exact recovery boundary");
  assert(player.collidable && !player.invulnerable, "player recovers");

  player.kill(10000);
  const respawned = player.respawn(11000, 400, 700);
  deepEqual(respawned.map((event) => event.id), ["player.respawn.place", "player.invulnerability.begin"], "respawn places before collision enable");
  const respawnAdvance = player.advanceTo(12000);
  deepEqual(respawnAdvance.map((event) => [event.id, event.simulationTimeMs]), [
    ["player.collision.on", 11400],
    ["player.invulnerability.end", 11700],
  ], "respawn traverses collision and invulnerability boundaries");
}

function testProjectileTiming(): void {
  const projectile = new ProjectileCollisionController(0, 220);
  equal(projectile.advanceTo(219).length, 0, "projectile remains unarmed");
  const armed = projectile.advanceTo(1000);
  deepEqual(armed.map((event) => [event.id, event.simulationTimeMs]), [["projectile.collision.on", 220]], "large delta arms at exact time");
  assert(projectile.collidable, "armed projectile collides");
  const cancelled = projectile.cancel(1001);
  deepEqual(cancelled.map((event) => event.id), ["projectile.collision.off", "projectile.cancel.commit"], "cancel disables collision before VFX");
  assert(!projectile.collidable && projectile.residue, "cancel residue is non-collidable");
  equal(projectile.cancel(1002).length, 0, "projectile cancel is idempotent");
}

function testLaserStateMachine(): void {
  const laser = new BossLaserMachine({telegraphMs:10, chargeMs:10, growMs:10, liveMs:10, shutdownMs:10, residueMs:10});
  deepEqual(laser.trigger().map((event) => event.id), ["laser.telegraph.begin", "visual.laser.warning.show"], "laser trigger enters telegraph");
  const events = laser.advance(60);
  const gameplayIds = events.filter((event) => event.channel === "gameplay").map((event) => event.id);
  deepEqual(gameplayIds, [
    "laser.charge.begin",
    "laser.grow.begin",
    "laser.collision.on",
    "laser.live.begin",
    "laser.collision.off",
    "laser.shutdown.begin",
    "laser.residue.begin",
    "laser.complete",
  ], "large delta traverses every laser state");
  equal(laser.state, "idle", "laser returns to idle");
  assert(!laser.collisionEnabled, "laser collision is off outside live");
  const onIndex = events.findIndex((event) => event.id === "laser.collision.on");
  const liveVisualIndex = events.findIndex((event) => event.id === "visual.laser.body.live");
  assert(onIndex >= 0 && onIndex < liveVisualIndex, "live collision enables before visual live state");
  const offIndex = events.findIndex((event) => event.id === "laser.collision.off");
  const shutdownVisualIndex = events.findIndex((event) => event.id === "visual.laser.shutdown");
  assert(offIndex >= 0 && offIndex < shutdownVisualIndex, "shutdown collision disables before visual shutdown");

  const cancelledLaser = new BossLaserMachine({telegraphMs:1, chargeMs:1, growMs:1, liveMs:100, shutdownMs:1, residueMs:1});
  cancelledLaser.trigger();
  cancelledLaser.advance(3);
  equal(cancelledLaser.state, "live", "cancel fixture reaches live");
  assert(cancelledLaser.collisionEnabled, "live fixture collision is enabled");
  const cancelled = cancelledLaser.cancel();
  equal(cancelled[0].id, "laser.collision.off", "live cancel disables collision first");
  equal(cancelledLaser.state, "shutdown", "cancel enters shutdown");
  assert(!cancelledLaser.collisionEnabled, "cancel disables collision immediately");
  equal(cancelledLaser.cancel().length, 0, "laser cancel is idempotent");
  const afterCancel = cancelledLaser.advance(1000);
  equal(afterCancel.filter((event) => event.id === "laser.collision.on").length, 0, "cancelled cycle never re-enables collision");
  equal(afterCancel.filter((event) => event.id === "laser.complete").length, 1, "cancelled cycle completes cleanup once");
}

function testStableIntersectionAndSweep(): void {
  const collider = new StableIntersectionCollider(
    new CircleShape({x:0, y:0}, 5),
    new AabbShape({minX:0, minY:-2, maxX:10, maxY:2}),
  );
  assert(collider.contains({x:1, y:0}), "point in both shapes collides");
  assert(!collider.contains({x:-1, y:0}), "point in only primary shape does not collide");
  collider.visualPoses({x:1000, y:1000});
  assert(collider.contains({x:1, y:0}), "visual jitter cannot mutate gameplay collision");

  collider.updateGameplayPose(
    new CircleShape({x:-100, y:0}, 1),
    new AabbShape({minX:100, minY:100, maxX:101, maxY:101}),
  );
  assert(!collider.collisionEnabled, "empty stable intersection disables collision");
  equal(collider.takeDiagnostics(42).length, 1, "empty intersection emits diagnostic once");
  equal(collider.takeDiagnostics(43).length, 0, "empty intersection diagnostic is idempotent");

  assert(sweptCircleHit({x:-10, y:0}, {x:10, y:0}, 0.5, {x:0, y:0}, 0.5), "sweep catches tunnelling hit");
  assert(!sweptCircleHit({x:-10, y:5}, {x:10, y:5}, 0.5, {x:0, y:0}, 0.5), "sweep rejects separated path");
}

function testBindingGraphAndIdempotency(): void {
  const graph = new BindingGraph({
    nodes:[
      {id:"event", kind:"gameplay-event"},
      {id:"effect", kind:"effect", ref:"sprite.damage_flash"},
    ],
    edges:[{id:"edge", from:"event", to:"effect", scope:"perEvent"}],
  });
  const calls: string[] = [];
  const context = {instanceId:"player", generation:1, occurrenceId:"hit-4"};
  graph.dispatch("event", context, (node) => calls.push(node.id));
  graph.dispatch("event", context, (node) => calls.push(node.id));
  deepEqual(calls, ["effect"], "duplicate binding executes once");

  let attempts = 0;
  const retryContext = {instanceId:"player", generation:1, occurrenceId:"hit-5"};
  throws(() => graph.dispatch("event", retryContext, () => {
    attempts += 1;
    throw new Error("sink failed");
  }), /sink failed/, "failed visual sink is reported");
  graph.dispatch("event", retryContext, () => { attempts += 1; });
  equal(attempts, 2, "failed visual sink rolls back its idempotency claim for retry");

  const segmented = new BindingGraph({
    nodes:[
      {id:"residue-event",kind:"gameplay-event"},
      {id:"lifecycle-clip",kind:"clip",ref:"bullet.lifecycle"},
    ],
    edges:[{
      id:"residue-segment",
      from:"residue-event",
      to:"lifecycle-clip",
      scope:"perEvent",
      segment:{fromFrameId:"bullet.afterimage",toFrameId:"bullet.clear"},
    }],
  });
  let segment = "";
  segmented.dispatch("residue-event", {instanceId:"bullet",occurrenceId:"cancel-residue-1"}, (_node, edge) => {
    segment = `${edge.segment?.fromFrameId}->${edge.segment?.toFrameId}`;
  });
  equal(segment, "bullet.afterimage->bullet.clear", "binding sink receives the v3 lifecycle residue segment");

  throws(() => new BindingGraph({
    nodes:[{id:"a",kind:"effect"}, {id:"b",kind:"effect"}],
    edges:[
      {id:"a-b",from:"a",to:"b",scope:"perInstance"},
      {id:"b-a",from:"b",to:"a",scope:"perInstance"},
    ],
  }), /cycle/, "binding cycles are rejected");

  throws(() => new BindingGraph({
    nodes:[{id:"visual",kind:"visual-event"}, {id:"gameplay",kind:"gameplay-event"}],
    edges:[{id:"bad",from:"visual",to:"gameplay",scope:"perEvent"}],
  }), /authoritative gameplay/, "visual-to-gameplay binding is rejected");

  throws(() => new BindingGraph({
    nodes:[{id:"visual",kind:"visual-event"}, {id:"effect",kind:"effect"}],
    edges:[{id:"visual-chain",from:"visual",to:"effect",scope:"perEvent"}],
  }), /direct gameplay-event/, "visual nodes cannot create a secondary effect chain");
}

const tests: [string, () => void][] = [
  ["large delta timeline", testLargeDeltaTimeline],
  ["loop reset and overflow", testLoopResetAndOverflow],
  ["visual hold/completion/cancel", testVisualHoldCompletionAndCancel],
  ["reduced-motion equivalence", testReducedMotionEquivalence],
  ["v3 aligned action separation", testV3AlignedActionSeparation],
  ["player collision timing", testPlayerTiming],
  ["projectile collision timing", testProjectileTiming],
  ["boss laser state machine", testLaserStateMachine],
  ["stable intersection and sweep", testStableIntersectionAndSweep],
  ["binding graph and idempotency", testBindingGraphAndIdempotency],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`all ${tests.length} runtime tests passed`);
