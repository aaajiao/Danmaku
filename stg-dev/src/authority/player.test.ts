import {describe, expect, it} from "vitest";

import {AuthorityClock} from "./clock";
import {
  CanonicalEventBus,
  type CanonicalEventBatchReceipt,
  type GameplayEventDraft,
} from "./events";
import {
  DirectionalOverrideAuthority,
  EvidenceAuthority,
  GrazeEvidenceAuthority,
  PlayerDamageAuthority,
  V4_PLAYER_AUTHORITY_CONTRACT,
  inspectPreparedPlayerDamageCommit,
  isExactPlayerDamageAuthority,
  playerInputEligibleAtTick,
  runtime60DeadlineTick,
  type DamageHit,
  type PlayerDamageConfig,
  type PreparedPlayerDamageCommit,
} from "./player";
import {ProjectileAuthorityPool, type ProjectileHandle} from "./projectiles";

const FAST_DAMAGE_CONFIG: PlayerDamageConfig = {
  maxHealth: 2,
  initialLives: 2,
  nonFatalInvulnerabilityMs: 100,
  respawnPlaceMs: 120,
  respawnInvulnerabilityEndMs: 220,
};

const FAST_OVERRIDE_CONFIG = {
  evidenceCost: 2,
  chargeMs: 100,
  activeMs: 200,
  sedimentMs: 50,
  cooldownMs: 100,
  radius: 100,
  halfAngleDegrees: 30,
} as const;

function appendPrepared(
  bus: CanonicalEventBus,
  drafts: readonly GameplayEventDraft[],
): CanonicalEventBatchReceipt {
  return bus.enqueuePreparedBatch([drafts])[0] as CanonicalEventBatchReceipt;
}

function makeProjectilePool(bus: CanonicalEventBus, authorityId = "projectiles"): ProjectileAuthorityPool {
  return new ProjectileAuthorityPool(bus, {
    authorityId,
    archetypes: [{id: "test-packet", poolClass: "micro", collisionRadiusPx: 2}],
  });
}

function spawnProjectile(
  pool: ProjectileAuthorityPool,
  occurrenceKey: string,
  x: number,
  y: number,
  tick120 = 0,
  residueTicks = 0,
): ProjectileHandle {
  const handle = pool.spawn({
    tick120,
    occurrenceKey,
    archetypeId: "test-packet",
    position: {x, y},
    armDelayTicks: 0,
    residueTicks,
  });
  expect(handle).not.toBeNull();
  return handle as ProjectileHandle;
}

function runDamageOrder(hits: readonly DamageHit[]): Readonly<{
  resultSource: string | null;
  trace: string;
}> {
  const bus = new CanonicalEventBus();
  const player = new PlayerDamageAuthority(bus, {
    playerId: "player:stable",
    config: FAST_DAMAGE_CONFIG,
  });
  const result = player.commitDamageBatch(1, hits);
  bus.flush();
  return Object.freeze({resultSource: result.committedSourceId, trace: bus.canonicalSerialization()});
}

describe("V4 player authority source", () => {
  it("derives the player and directional Override machines from V4", () => {
    expect(V4_PLAYER_AUTHORITY_CONTRACT).toEqual({
      schemaVersion: "4.0.0",
      playerDamageStates: ["alive", "dead", "respawning", "run-ended"],
      grazeAwardStates: ["unseen", "awarded"],
      grazeAwardKey: "projectileInstanceId:projectileGeneration:playerId",
      grazeAwardMaximumPerKey: 1,
      directionalOverrideStates: ["idle", "charging", "active", "sediment", "cooldown"],
      directionalOverrideGeometry: "forward-sector",
      overrideVoidCancellationConsequence: "override scar at exact cancellation coordinate",
      canonicalRoomIds: ["INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"],
      globalInvulnerability: false,
    });
  });

  it("maps reference durations to non-early even master boundaries", () => {
    expect(runtime60DeadlineTick(0, 1000)).toBe(120);
    expect(runtime60DeadlineTick(1, 1000)).toBe(122);
    expect(runtime60DeadlineTick(2, 520)).toBe(66);
    expect(runtime60DeadlineTick(2, 0)).toBe(2);
    expect(runtime60DeadlineTick(3, 0)).toBe(4);
    expect(runtime60DeadlineTick(1, 17)).toBe(4);
    for (let start = 0; start < 12; start += 1) {
      expect(runtime60DeadlineTick(start, 17) % 2).toBe(0);
      expect(runtime60DeadlineTick(start, 17)).toBeGreaterThan(start);
    }
  });
});

describe("player collision and damage authority", () => {
  it("keeps collision blocked until the final owner lease releases", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus);
    const room = player.acquireCollisionBlocker("room", "world-swap", 0);
    const snapshot = player.acquireCollisionBlocker("snapshot", "serialize", 1);
    expect(player.snapshot().collisionEnabled).toBe(false);
    player.releaseCollisionBlocker(room.token, 2);
    expect(player.snapshot().collisionEnabled).toBe(false);
    player.releaseCollisionBlocker(snapshot.token, 3);
    expect(player.snapshot().collisionEnabled).toBe(true);

    const events = bus.flush();
    expect(events.map((event) => event.id)).toEqual([
      "player.collision.off",
      "player.collision.on",
    ]);
    expect(events.map((event) => event.tick120)).toEqual([0, 3]);
  });

  it("sorts competing hits by stable source identity and commits at most one", () => {
    const hits: readonly DamageHit[] = [
      {occurrenceKey: "hit-z", sourceId: "source:z", amount: 2},
      {occurrenceKey: "hit-a", sourceId: "source:a", amount: 1},
      {occurrenceKey: "hit-m", sourceId: "source:m", amount: 2},
    ];
    const forward = runDamageOrder(hits);
    const reverse = runDamageOrder(hits.slice().reverse());
    expect(forward).toEqual(reverse);
    expect(forward.resultSource).toBe("source:a");

    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    const result = player.commitDamageBatch(1, hits);
    expect(result.hits.map((hit) => [hit.sourceId, hit.disposition])).toEqual([
      ["source:a", "committed"],
      ["source:m", "competing"],
      ["source:z", "competing"],
    ]);
    expect(result.branch).toBe("non-fatal");
    expect(player.snapshot().health).toBe(1);
    expect(() => player.commitDamageBatch(1, [
      {occurrenceKey: "late", sourceId: "source:late", amount: 1},
    ])).toThrow(/already committed for tick/);
  });

  it("prepares an opaque frozen one-use commit before a coordinator appends it", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    const before = player.snapshot();
    const proposal = player.prepareDamageBatch(1, [
      {occurrenceKey: "prepared", sourceId: "laser:prepared", amount: 1},
    ]);
    const view = inspectPreparedPlayerDamageCommit(proposal);

    expect(isExactPlayerDamageAuthority(player)).toBe(true);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Reflect.ownKeys(proposal)).toEqual([]);
    expect(player.snapshot()).toEqual(before);
    expect(view).toMatchObject({
      owner: player,
      eventBus: bus,
      tick120: 1,
      revision: 0,
      result: {committedSourceId: "laser:prepared", branch: "non-fatal"},
      preview: {tick120: 1, health: 1, collisionEnabled: false},
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.drafts)).toBe(true);
    expect(Object.isFrozen(view.result)).toBe(true);
    expect(Object.isFrozen(view.result.hits)).toBe(true);
    expect(Object.isFrozen(view.preview)).toBe(true);
    for (const draft of view.drafts) {
      expect(Object.getPrototypeOf(draft)).toBe(Object.prototype);
      expect(Object.keys(draft).sort()).toEqual([
        "entityStableId",
        "id",
        "localSequence",
        "occurrenceKey",
        "payload",
        "tick120",
      ]);
      expect(Object.isFrozen(draft)).toBe(true);
      expect(Object.getPrototypeOf(draft.payload)).toBe(Object.prototype);
      expect(Object.isFrozen(draft.payload)).toBe(true);
    }

    expect(player.validatePreparedDamageCommit(proposal)).toEqual(view);
    expect(() => player.applyPreparedDamageAfterAppend(
      proposal,
      Object.freeze({}) as CanonicalEventBatchReceipt,
    )).toThrow(/receipt is not recognized/);
    expect(player.snapshot()).toEqual(before);
    const receipt = appendPrepared(bus, view.drafts);
    let applied: ReturnType<PlayerDamageAuthority["applyPreparedDamageAfterAppend"]> | null = null;
    expect(() => {
      applied = player.applyPreparedDamageAfterAppend(proposal, receipt);
    }).not.toThrow();
    expect(applied).toBe(view.result);
    expect(player.snapshot()).toEqual(view.preview);
    expect(() => player.applyPreparedDamageAfterAppend(proposal, receipt)).toThrow(/consumed/);
    expect(() => inspectPreparedPlayerDamageCommit(proposal)).toThrow(/already consumed/);
  });

  it("stages exact recovery and respawn crossings without a stale collision-on", () => {
    const recoveryBus = new CanonicalEventBus();
    const recovering = new PlayerDamageAuthority(recoveryBus, {config: FAST_DAMAGE_CONFIG});
    recovering.commitDamageBatch(1, [
      {occurrenceKey: "recovery-first", sourceId: "projectile:first", amount: 1},
    ]);
    recoveryBus.flush();
    const recoveryBefore = recovering.snapshot();
    const recoveryProposal = recovering.prepareDamageBatch(14, [
      {occurrenceKey: "recovery-boundary", sourceId: "laser:boundary", amount: 1},
    ]);
    const recoveryView = inspectPreparedPlayerDamageCommit(recoveryProposal);
    expect(recovering.snapshot()).toEqual(recoveryBefore);
    expect(recoveryView.drafts.map((draft) => draft.id)).toEqual([
      "player.invulnerability.end",
      "player.collision.off",
      "player.death.commit",
      "player.life.consume",
    ]);
    expect(recoveryView.drafts.some((draft) => draft.id === "player.collision.on")).toBe(false);
    const recoveryReceipt = appendPrepared(recoveryBus, recoveryView.drafts);
    recovering.applyPreparedDamageAfterAppend(recoveryProposal, recoveryReceipt);
    expect(recovering.snapshot()).toEqual(recoveryView.preview);

    const respawnBus = new CanonicalEventBus();
    const respawning = new PlayerDamageAuthority(respawnBus, {config: FAST_DAMAGE_CONFIG});
    respawning.commitDamageBatch(1, [
      {occurrenceKey: "respawn-first", sourceId: "projectile:fatal", amount: 2},
    ]);
    respawnBus.flush();
    const respawnBefore = respawning.snapshot();
    const respawnProposal = respawning.prepareDamageBatch(28, [
      {occurrenceKey: "respawn-boundary", sourceId: "laser:respawn", amount: 1},
    ]);
    const respawnView = inspectPreparedPlayerDamageCommit(respawnProposal);
    expect(respawning.snapshot()).toEqual(respawnBefore);
    expect(respawnView.drafts.map((draft) => [draft.id, draft.tick120])).toEqual([
      ["player.respawn.place", 16],
      ["player.invulnerability.begin", 16],
      ["player.invulnerability.end", 28],
      ["player.respawn.complete", 28],
      ["player.collision.off", 28],
      ["player.damage.commit", 28],
      ["player.invulnerability.begin", 28],
    ]);
    expect(respawnView.drafts.some((draft) => draft.id === "player.collision.on")).toBe(false);
    const respawnReceipt = appendPrepared(respawnBus, respawnView.drafts);
    respawning.applyPreparedDamageAfterAppend(respawnProposal, respawnReceipt);
    expect(respawning.snapshot()).toEqual(respawnView.preview);
  });

  it("commits every prepared hit claim and processed-tick effect, including blocked hits", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    const blocker = player.acquireCollisionBlocker("fixture", "blocked-hit", 0);
    bus.flush();
    const proposal = player.prepareDamageBatch(1, [
      {occurrenceKey: "blocked-claim", sourceId: "laser:blocked", amount: 1},
    ]);
    const view = inspectPreparedPlayerDamageCommit(proposal);
    expect(view.drafts).toEqual([]);
    expect(view.result.hits[0]?.disposition).toBe("blocked");
    player.applyPreparedDamageAfterAppend(proposal, appendPrepared(bus, view.drafts));
    expect(() => player.prepareDamageBatch(1, [
      {occurrenceKey: "different", sourceId: "laser:different", amount: 1},
    ])).toThrow(/already committed for tick/);
    player.releaseCollisionBlocker(blocker.token, 2);
    expect(() => player.prepareDamageBatch(3, [
      {occurrenceKey: "blocked-claim", sourceId: "laser:replay", amount: 1},
    ])).toThrow(/duplicate damage hit occurrence/);
  });

  it("rejects forged, cross-owner, stale, and replayed prepared commits", () => {
    const firstBus = new CanonicalEventBus();
    const first = new PlayerDamageAuthority(firstBus, {config: FAST_DAMAGE_CONFIG});
    const second = new PlayerDamageAuthority(new CanonicalEventBus(), {config: FAST_DAMAGE_CONFIG});
    const proposal = first.prepareDamageBatch(0, [
      {occurrenceKey: "stale", sourceId: "laser:stale", amount: 1},
    ]);
    const forged = Object.freeze({}) as PreparedPlayerDamageCommit;
    expect(() => first.validatePreparedDamageCommit(forged)).toThrow(/unknown/);
    expect(() => second.validatePreparedDamageCommit(proposal)).toThrow(/another player\/event bus/);
    first.advanceTo(0);
    expect(() => first.validatePreparedDamageCommit(proposal)).toThrow(/stale/);
    expect(() => inspectPreparedPlayerDamageCommit(proposal)).toThrow(/stale/);
    expect(() => first.applyPreparedDamageAfterAppend(
      proposal,
      Object.freeze({}) as CanonicalEventBatchReceipt,
    )).toThrow(/stale/);

    const fresh = first.prepareDamageBatch(1, [
      {occurrenceKey: "one-use", sourceId: "laser:one-use", amount: 1},
    ]);
    const freshView = first.validatePreparedDamageCommit(fresh);
    const freshReceipt = appendPrepared(firstBus, freshView.drafts);
    first.applyPreparedDamageAfterAppend(fresh, freshReceipt);
    expect(() => first.validatePreparedDamageCommit(fresh)).toThrow(/consumed/);
    expect(() => first.applyPreparedDamageAfterAppend(fresh, freshReceipt)).toThrow(/consumed/);
  });

  it("binds an accepted receipt to the exact same-revision proposal drafts", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    const first = player.prepareDamageBatch(1, [
      {occurrenceKey: "receipt:first", sourceId: "laser:first", amount: 1},
    ]);
    const second = player.prepareDamageBatch(1, [
      {occurrenceKey: "receipt:second", sourceId: "laser:second", amount: 1},
    ]);
    const firstView = player.validatePreparedDamageCommit(first);
    const receipt = appendPrepared(bus, firstView.drafts);
    expect(() => player.applyPreparedDamageAfterAppend(second, receipt)).toThrow(/does not cover/);
    expect(player.snapshot()).toMatchObject({tick120: 0, health: 2, activeLeases: []});
    expect(() => player.applyPreparedDamageAfterAppend(first, receipt)).not.toThrow();
    expect(player.snapshot()).toMatchObject({tick120: 1, health: 1});
  });

  it("keeps distinct empty prepared groups non-interchangeable", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    player.acquireCollisionBlocker("fixture", "empty-receipt", 0);
    bus.flush();
    const before = player.snapshot();
    const first = player.prepareDamageBatch(1, [
      {occurrenceKey: "empty:first", sourceId: "laser:first", amount: 1},
    ]);
    const second = player.prepareDamageBatch(2, [
      {occurrenceKey: "empty:second", sourceId: "laser:second", amount: 1},
    ]);
    const firstView = player.validatePreparedDamageCommit(first);
    const secondView = player.validatePreparedDamageCommit(second);
    expect(firstView.drafts).toEqual([]);
    expect(secondView.drafts).toEqual([]);
    expect(firstView.drafts).not.toBe(secondView.drafts);
    const receipt = appendPrepared(bus, firstView.drafts);
    expect(() => player.applyPreparedDamageAfterAppend(second, receipt)).toThrow(/does not cover/);
    expect(player.snapshot()).toEqual(before);
    expect(() => player.applyPreparedDamageAfterAppend(first, receipt)).not.toThrow();
    expect(player.snapshot()).toMatchObject({tick120: 1, health: 2});
  });

  it("captures own hit data and locks out descriptor-trap reentrancy", () => {
    const player = new PlayerDamageAuthority(new CanonicalEventBus(), {config: FAST_DAMAGE_CONFIG});
    const before = player.snapshot();
    let accessorReads = 0;
    const accessorHit = Object.defineProperty({
      sourceId: "laser:accessor",
      amount: 1,
    }, "occurrenceKey", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "accessor";
      },
    });
    expect(() => player.prepareDamageBatch(
      0,
      [accessorHit] as unknown as readonly DamageHit[],
    )).toThrow(/own enumerable data property/);
    expect(accessorReads).toBe(0);
    expect(player.snapshot()).toEqual(before);

    let reentryAttempts = 0;
    const reentrantHits = new Proxy([{
      occurrenceKey: "reentrant",
      sourceId: "laser:reentrant",
      amount: 1,
    }], {
      getOwnPropertyDescriptor(target, key) {
        if (key === "0" && reentryAttempts === 0) {
          reentryAttempts += 1;
          player.advanceTo(0);
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(() => player.prepareDamageBatch(0, reentrantHits)).toThrow(/already in progress/);
    expect(reentryAttempts).toBe(1);
    expect(player.snapshot()).toEqual(before);
    expect(() => player.prepareDamageBatch(0, [{
      occurrenceKey: "after-reentry",
      sourceId: "laser:after-reentry",
      amount: 1,
    }])).not.toThrow();
  });

  it("keeps non-fatal and fatal branches atomically exclusive", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    player.commitDamageBatch(1, [
      {occurrenceKey: "soft", sourceId: "projectile:soft", amount: 1},
    ]);
    const recoveryTick = player.snapshot().recoveryAtTick120;
    expect(recoveryTick).toBe(14);
    player.advanceTo(recoveryTick ?? 0);
    player.commitDamageBatch(15, [
      {occurrenceKey: "fatal", sourceId: "projectile:fatal", amount: 2},
    ]);
    expect(player.snapshot().state).toBe("dead");

    const events = bus.flush();
    const atFatal = events.filter((event) => event.tick120 === 15);
    expect(atFatal.map((event) => event.id)).toEqual([
      "player.collision.off",
      "player.death.commit",
      "player.life.consume",
    ]);
    expect(atFatal.some((event) => event.id === "player.damage.commit")).toBe(false);
  });

  it("does not emit a stale collision-on when recovery and a new hit share a tick", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    player.commitDamageBatch(1, [
      {occurrenceKey: "first", sourceId: "projectile:first", amount: 1},
    ]);
    expect(player.snapshot().recoveryAtTick120).toBe(14);
    player.commitDamageBatch(14, [
      {occurrenceKey: "same-boundary", sourceId: "projectile:second", amount: 1},
    ]);
    expect(player.snapshot().state).toBe("dead");
    expect(player.snapshot().collisionEnabled).toBe(false);

    const atBoundary = bus.flush().filter((event) => event.tick120 === 14);
    expect(atBoundary.map((event) => event.id)).toEqual([
      "player.collision.off",
      "player.invulnerability.end",
      "player.death.commit",
      "player.life.consume",
    ]);
    expect(atBoundary.some((event) => event.id === "player.collision.on")).toBe(false);
  });

  it("crosses respawn boundaries exactly once and retains overlapping leases", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    player.commitDamageBatch(1, [
      {occurrenceKey: "fatal-respawn", sourceId: "projectile:heavy", amount: 2},
    ]);
    const transition = player.acquireCollisionBlocker("room", "transition-stabilization", 2);
    const dead = player.snapshot();
    expect(dead.respawnPlaceAtTick120).toBe(16);
    expect(dead.respawnCompleteAtTick120).toBe(28);

    player.advanceTo(15);
    expect(player.snapshot().state).toBe("dead");
    player.advanceTo(16);
    expect(player.snapshot().state).toBe("respawning");
    player.advanceTo(10_000);
    expect(player.snapshot().state).toBe("alive");
    expect(player.snapshot().collisionEnabled).toBe(false);
    player.releaseCollisionBlocker(transition.token, 10_001);
    expect(player.snapshot().collisionEnabled).toBe(true);

    const events = bus.flush();
    expect(events.filter((event) => event.id === "player.respawn.place")).toHaveLength(1);
    expect(events.filter((event) => event.id === "player.respawn.complete")).toHaveLength(1);
    expect(events.find((event) => event.id === "player.respawn.place")?.tick120).toBe(16);
    expect(events.find((event) => event.id === "player.respawn.complete")?.tick120).toBe(28);
    expect(events.filter((event) => event.id === "player.collision.on")).toHaveLength(1);
    expect(events.find((event) => event.id === "player.collision.on")?.tick120).toBe(10_001);
  });

  it("derives input eligibility from retained life state without advancing the player machine", () => {
    const player = new PlayerDamageAuthority(new CanonicalEventBus(), {config: FAST_DAMAGE_CONFIG});
    expect(playerInputEligibleAtTick(player.snapshot(), 10)).toBe(true);
    player.commitDamageBatch(1, [
      {occurrenceKey: "input-gate-fatal", sourceId: "projectile:input-gate", amount: 2},
    ]);
    const dead = player.snapshot();

    expect(playerInputEligibleAtTick(dead, 15)).toBe(false);
    expect(playerInputEligibleAtTick(dead, 16)).toBe(false);
    expect(playerInputEligibleAtTick(dead, 27)).toBe(false);
    expect(playerInputEligibleAtTick(dead, 28)).toBe(true);
    expect(player.snapshot()).toEqual(dead);
    expect(() => playerInputEligibleAtTick(dead, 0)).toThrow(/cannot inspect backward/);

    player.advanceTo(16);
    const respawning = player.snapshot();
    expect(respawning.state).toBe("respawning");
    expect(playerInputEligibleAtTick(respawning, 27)).toBe(false);
    expect(playerInputEligibleAtTick(respawning, 28)).toBe(true);
    expect(player.snapshot()).toEqual(respawning);

    const exhausted = new PlayerDamageAuthority(new CanonicalEventBus(), {
      config: {...FAST_DAMAGE_CONFIG, maxHealth: 1, initialLives: 1},
    });
    exhausted.commitDamageBatch(3, [
      {occurrenceKey: "input-gate-run-end", sourceId: "projectile:last", amount: 1},
    ]);
    expect(playerInputEligibleAtTick(exhausted.snapshot(), 100_000)).toBe(false);
  });

  it("ends exhausted lives in an immutable handoff without stale respawn", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {
      config: {...FAST_DAMAGE_CONFIG, maxHealth: 1, initialLives: 1},
    });
    player.commitDamageBatch(3, [
      {occurrenceKey: "last-life", sourceId: "projectile:last", amount: 1},
    ]);
    player.advanceTo(100_000);
    const snapshot = player.snapshot();
    expect(snapshot.state).toBe("run-ended");
    expect(snapshot.handoff).toEqual({reason: "lives-exhausted", tick120: 3});
    expect(snapshot.respawnPlaceAtTick120).toBeNull();
    expect(snapshot.respawnCompleteAtTick120).toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);

    const events = bus.flush();
    expect(events.filter((event) => event.id === "run.end.commit")).toHaveLength(1);
    expect(events.some((event) => event.id === "player.respawn.place")).toBe(false);
  });

  it("leaves state untouched when a command is invalid", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus);
    const before = player.snapshot();
    expect(() => player.commitDamageBatch(200, [
      {occurrenceKey: "invalid", sourceId: "projectile:x", amount: 0},
    ])).toThrow(/positive safe integer/);
    expect(player.snapshot()).toEqual(before);
    expect(() => player.releaseCollisionBlocker("unknown", 300)).toThrow(/unknown or released/);
    expect(player.snapshot()).toEqual(before);
    expect(bus.events()).toEqual([]);
  });

  it("does not leave a lease or partial events when a damage batch conflicts on the bus", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus);
    bus.enqueue({
      id: "player.damage.commit",
      tick120: 5,
      entityStableId: "fixture",
      localSequence: 0,
      occurrenceKey: "player:damage:occupied",
      payload: {amount: 1, healthAfter: 2, sourceId: "fixture", branch: "non-fatal"},
    });

    expect(() => player.commitDamageBatch(5, [
      {occurrenceKey: "occupied", sourceId: "projectile:occupied", amount: 1},
    ])).toThrow(/duplicate authoritative occurrence key/);
    expect(player.snapshot()).toMatchObject({
      tick120: 0,
      state: "alive",
      health: 3,
      collisionEnabled: true,
      activeLeases: [],
      recoveryAtTick120: null,
    });
    expect(bus.flush().map((event) => event.occurrenceKey)).toEqual(["player:damage:occupied"]);
  });

  it("leaves the recovery lease and deadlines intact when damage append is rejected", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {
      config: {...FAST_DAMAGE_CONFIG, maxHealth: 3},
    });
    player.commitDamageBatch(1, [
      {occurrenceKey: "first", sourceId: "projectile:first", amount: 1},
    ]);
    bus.flush();
    const before = player.snapshot();
    expect(before).toMatchObject({
      tick120: 1,
      health: 2,
      collisionEnabled: false,
      recoveryAtTick120: 14,
    });

    const recoveryTick = 14;
    bus.enqueue({
      id: "boss.encounter.resolve",
      tick120: recoveryTick,
      entityStableId: "fixture:recovery-conflict",
      localSequence: 0,
      occurrenceKey: "player:damage:recovery-conflict",
      payload: {
        bossId: "fixture.recovery-conflict",
        generation: 1,
        outcome: "occupied",
        finalPhaseId: "fixture",
      },
    });
    expect(() => player.commitDamageBatch(recoveryTick, [
      {
        occurrenceKey: "recovery-conflict",
        sourceId: "projectile:recovery-conflict",
        amount: 1,
      },
    ])).toThrow(/duplicate authoritative occurrence key/);
    expect(player.snapshot()).toEqual(before);
    expect(bus.flush().map((event) => event.occurrenceKey)).toEqual([
      "player:damage:recovery-conflict",
    ]);
  });

  it("drains zero-duration respawn boundaries at the current even tick", () => {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {
      config: {
        maxHealth: 1,
        initialLives: 2,
        nonFatalInvulnerabilityMs: 0,
        respawnPlaceMs: 0,
        respawnInvulnerabilityEndMs: 0,
      },
    });
    player.commitDamageBatch(2, [
      {occurrenceKey: "zero-respawn", sourceId: "projectile:zero", amount: 1},
    ]);
    expect(player.snapshot()).toMatchObject({
      state: "alive",
      health: 1,
      lives: 1,
      collisionEnabled: true,
    });
    const events = bus.flush().filter((event) => event.tick120 === 2);
    expect(events.map((event) => event.id)).toEqual([
      "player.collision.off",
      "player.death.commit",
      "player.life.consume",
      "player.respawn.place",
      "player.invulnerability.begin",
      "player.invulnerability.end",
      "player.respawn.complete",
      "player.collision.on",
    ]);
  });
});

describe("evidence and graze authority", () => {
  it("awards once for each projectile generation and player key", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus, "graze-pool");
    const evidence = new EvidenceAuthority(bus);
    const graze = new GrazeEvidenceAuthority(bus, evidence);
    const first = spawnProjectile(pool, "first", 10, 10);
    expect(graze.tryAward(pool, first, "player:0", 1)).toBe(true);
    expect(graze.tryAward(pool, first, "player:0", 2)).toBe(false);
    expect(graze.tryAward(pool, first, "player:1", 2)).toBe(true);
    pool.cancel(first, 3, "pattern_end");

    const second = spawnProjectile(pool, "second", 10, 10, 4);
    expect(second.instanceId).toBe(first.instanceId);
    expect(second.generation).toBe(first.generation + 1);
    expect(graze.tryAward(pool, second, "player:0", 5)).toBe(true);
    expect(evidence.amount).toBe(3);

    const events = bus.flush();
    const grazes = events.filter((event) => event.id === "projectile.graze.commit");
    expect(grazes).toHaveLength(3);
    expect(grazes.map((event) => [
      event.payload.projectileId,
      event.payload.projectileGeneration,
      event.payload.playerId,
    ])).toEqual([
      [first.instanceId, first.generation, "player:0"],
      [first.instanceId, first.generation, "player:1"],
      [second.instanceId, second.generation, "player:0"],
    ]);
    expect(events.filter((event) => event.id === "evidence.gain.commit")).toHaveLength(3);
  });

  it("does not credit inactive projectile state or duplicate evidence sources", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus);
    const evidence = new EvidenceAuthority(bus);
    const graze = new GrazeEvidenceAuthority(bus, evidence);
    const handle = spawnProjectile(pool, "inactive", 0, 0, 0, 20);
    pool.cancel(handle, 1, "pattern_end");
    expect(graze.tryAward(pool, handle, "player", 2)).toBe(false);
    expect(evidence.amount).toBe(0);

    evidence.credit(1, 3, "manual:one");
    const before = evidence.snapshot();
    expect(() => evidence.credit(1, 4, "manual:one")).toThrow(/already credited/);
    expect(evidence.snapshot()).toEqual(before);
  });

  it("rejects a graze timestamp that precedes projectile authority", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus);
    const evidence = new EvidenceAuthority(bus);
    const graze = new GrazeEvidenceAuthority(bus, evidence);
    const handle = spawnProjectile(pool, "future", 0, 0, 10);

    expect(() => graze.tryAward(pool, handle, "player", 1)).toThrow(/cannot move backward/);
    expect(evidence.amount).toBe(0);
    expect(graze.hasAward(handle, "player")).toBe(false);
  });
});

describe("directional Override authority", () => {
  it("supports charge cancellation and evidence denial", () => {
    const cancelBus = new CanonicalEventBus();
    const cancelEvidence = new EvidenceAuthority(cancelBus, 2);
    const cancelled = new DirectionalOverrideAuthority(cancelBus, cancelEvidence, {
      config: FAST_OVERRIDE_CONFIG,
    });
    expect(cancelled.press({origin: {x: 0, y: 0}, direction: {x: 2, y: 0}, roomId: "IN_BETWEEN"}, 1)).toBe(true);
    expect(cancelled.release(10)).toBe(true);
    expect(cancelled.snapshot().state).toBe("idle");
    expect(cancelEvidence.amount).toBe(2);
    expect(cancelBus.flush().map((event) => event.id)).toEqual([
      "player.override.charge.begin",
      "player.override.charge.cancel",
    ]);

    const deniedBus = new CanonicalEventBus();
    const deniedEvidence = new EvidenceAuthority(deniedBus, 1);
    const denied = new DirectionalOverrideAuthority(deniedBus, deniedEvidence, {
      config: FAST_OVERRIDE_CONFIG,
    });
    denied.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "POLARIZED"}, 0);
    denied.advanceTo(12);
    expect(denied.snapshot().state).toBe("idle");
    expect(deniedEvidence.amount).toBe(1);
    expect(deniedBus.flush().filter((event) => event.id === "player.override.denied")).toHaveLength(1);
  });

  it("uses a normalized finite forward sector", () => {
    const bus = new CanonicalEventBus();
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 10, y: 20}, direction: {x: 4, y: 0}, roomId: "POLARIZED"}, 0);
    override.advanceTo(12);
    expect(override.snapshot().state).toBe("active");
    expect(override.contains({x: 110, y: 20})).toBe(true);
    expect(override.contains({x: 111, y: 20})).toBe(false);
    expect(override.contains({x: 60, y: 20 + Math.tan(Math.PI / 6) * 50})).toBe(true);
    expect(override.contains({x: 10, y: 80})).toBe(false);
    expect(override.contains({x: -10, y: 20})).toBe(false);
    expect(override.snapshot().globalInvulnerability).toBe(false);
  });

  it("cancels only real sector entities and keeps their coordinates on the cycle scar", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus, "override-pool");
    const forward = spawnProjectile(pool, "forward", 50, 0, 0, 10);
    const angled = spawnProjectile(pool, "angled", 50, 20, 0, 10);
    const behind = spawnProjectile(pool, "behind", -50, 0, 0, 10);
    const side = spawnProjectile(pool, "side", 0, 50, 0, 10);
    const evidence = new EvidenceAuthority(bus, 4);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "FORCED_ALIGNMENT"}, 0);
    override.advanceTo(12);
    const cancellations = override.cancelProjectiles(pool, 12);

    expect(cancellations.map((entry) => entry.projectileId)).toEqual(
      [angled.instanceId, forward.instanceId].sort(),
    );
    expect(cancellations.map((entry) => entry.position)).toEqual([
      pool.snapshot(angled).position,
      pool.snapshot(forward).position,
    ].sort((left, right) => left.y - right.y));
    expect(pool.snapshot(behind).state).toBe("flight");
    expect(pool.snapshot(side).state).toBe("flight");
    expect(pool.snapshot(forward).state).toBe("residue");
    expect(pool.snapshot(angled).state).toBe("residue");

    override.advanceTo(10_000);
    expect(override.snapshot().state).toBe("idle");
    const scars = override.overrideScars();
    expect(scars).toHaveLength(2);
    expect(scars.map((scar) => scar.position)).toEqual(cancellations.map((entry) => entry.position));
    expect(scars.map((scar) => scar.cancellations)).toEqual(
      cancellations.map((entry) => [entry]),
    );
    expect(scars.every((scar) =>
      scar.scarType === "overrideScar"
      && scar.tick120 === 36
      && scar.roomId === "FORCED_ALIGNMENT")).toBe(true);
    const events = bus.flush();
    const scarEvents = events.filter((event) => event.id === "cross_run.scar.write.commit");
    expect(scarEvents).toHaveLength(2);
    expect(scarEvents.map((event) => ({x: event.payload.x, y: event.payload.y}))).toEqual(
      cancellations.map((entry) => entry.position),
    );
    expect(events.some((event) => event.id === "player.collision.off")).toBe(false);
    for (const handle of [forward, angled]) {
      const entityEvents = events.filter((event) =>
        event.entityStableId === handle.instanceId && event.tick120 === 12);
      expect(entityEvents.map((event) => event.id)).toEqual([
        "projectile.collision.off",
        "projectile.cancel.commit",
        "projectile.residue.begin",
      ]);
    }
  });

  it("cancels a projectile that sweeps through the local void at its entry coordinate", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus, "override-sweep-pool");
    const crossing = spawnProjectile(pool, "crossing", -150, 0, 0, 10);
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "IN_BETWEEN"}, 0);
    override.advanceTo(12);
    pool.move(crossing, 13, {x: 150, y: 0});

    const cancellations = override.cancelProjectiles(pool, 13);

    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]?.position.x).toBeCloseTo(0, 10);
    expect(cancellations[0]?.position.y).toBeCloseTo(0, 10);
    expect(pool.snapshot(crossing)).toMatchObject({
      state: "residue",
      collisionEnabled: false,
      position: {x: 0, y: 0},
    });
  });

  it("uses ordered authority paths and relocates an endpoint hit before writing its scar", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus, "override-path-pool");
    const crossing = spawnProjectile(pool, "ordered-crossing", -20, 0, 0, 10);
    pool.move(crossing, 13, {x: -20, y: 20});
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "IN_BETWEEN"}, 0);
    override.advanceTo(12);

    const cancellations = override.cancelProjectilesAlongPaths(pool, [{
      projectileId: crossing.instanceId,
      projectileGeneration: crossing.generation,
      segments: [
        {from: {x: -20, y: 0}, to: {x: 0, y: 0}},
        {from: {x: 0, y: 0}, to: {x: -20, y: 20}},
      ],
    }], 13);

    expect(cancellations).toEqual([expect.objectContaining({
      projectileId: crossing.instanceId,
      projectileGeneration: crossing.generation,
      position: {x: 0, y: 0},
    })]);
    expect(pool.snapshot(crossing)).toMatchObject({
      state: "residue",
      collisionEnabled: false,
      position: {x: 0, y: 0},
    });
    override.advanceTo(36);
    expect(override.overrideScars()).toEqual([expect.objectContaining({
      position: {x: 0, y: 0},
      cancellations: [expect.objectContaining({position: {x: 0, y: 0}})],
    })]);
  });

  it("sweeps disconnected authority path components without inventing a connector", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus, "override-component-path-pool");
    const crossing = spawnProjectile(pool, "component-crossing", 50, -50, 0, 10);
    pool.move(crossing, 13, {x: 50, y: 50});
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "IN_BETWEEN"}, 0);
    override.advanceTo(12);

    expect(override.cancelProjectilesAlongPaths(pool, [{
      projectileId: crossing.instanceId,
      projectileGeneration: crossing.generation,
      segments: [
        {from: {x: 50, y: -50}, to: {x: 50, y: -50}},
        {
          from: {x: 50, y: 50},
          to: {x: 50, y: 50},
          startsNewComponent: true,
        },
      ],
    }], 13)).toEqual([]);
    expect(pool.snapshot(crossing)).toMatchObject({
      state: "flight",
      position: {x: 50, y: 50},
    });
  });

  it("rejects hostile or non-authoritative paths without advancing Override or projectiles", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus, "override-hostile-path-pool");
    const flight = spawnProjectile(pool, "flight", -20, 0, 0, 10);
    pool.move(flight, 13, {x: 20, y: 0});
    const arm = spawnProjectile(pool, "arm", 40, 0, 13, 10);
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "IN_BETWEEN"}, 0);
    override.advanceTo(12);
    const valid = {
      projectileId: flight.instanceId,
      projectileGeneration: flight.generation,
      segments: [{from: {x: -20, y: 0}, to: {x: 20, y: 0}}],
    } as const;
    const cases: Array<readonly unknown[]> = [
      [{...valid, projectileId: "missing"}],
      [{...valid, projectileGeneration: flight.generation + 1}],
      [{...valid, segments: [{from: {x: -19, y: 0}, to: {x: 20, y: 0}}]}],
      [{...valid, segments: [
        {from: {x: -20, y: 0}, to: {x: 0, y: 0}},
        {from: {x: 1, y: 0}, to: {x: 20, y: 0}},
      ]}],
      [{...valid, segments: [{
        from: {x: -20, y: 0},
        to: {x: 20, y: 0},
        startsNewComponent: true,
      }]}],
      [{...valid, segments: [
        {from: {x: -20, y: 0}, to: {x: 0, y: 0}},
        {
          from: {x: 1, y: 0},
          to: {x: 20, y: 0},
          startsNewComponent: false,
        },
      ]}],
      [{...valid, segments: [
        {from: {x: -20, y: 0}, to: {x: 0, y: 0}},
        {
          from: {x: 0, y: 0},
          to: {x: 20, y: 0},
          startsNewComponent: true,
        },
      ]}],
      [{
        projectileId: arm.instanceId,
        projectileGeneration: arm.generation,
        segments: [{from: {x: 40, y: 0}, to: {x: 40, y: 0}}],
      }],
      [valid, valid],
    ];
    for (const paths of cases) {
      const overrideBefore = override.snapshot();
      const flightBefore = pool.snapshot(flight);
      const armBefore = pool.snapshot(arm);
      const eventCount = bus.events().length;
      expect(() => override.cancelProjectilesAlongPaths(
        pool,
        paths as Parameters<DirectionalOverrideAuthority["cancelProjectilesAlongPaths"]>[1],
        13,
      )).toThrow();
      expect(override.snapshot()).toEqual(overrideBefore);
      expect(pool.snapshot(flight)).toEqual(flightBefore);
      expect(pool.snapshot(arm)).toEqual(armBefore);
      expect(bus.events()).toHaveLength(eventCount);
    }
    const beforeWrongTick = override.snapshot();
    expect(() => override.cancelProjectilesAlongPaths(pool, [valid], 14)).toThrow(/moved on tick 14/);
    expect(override.snapshot()).toEqual(beforeWrongTick);

    let accessorReads = 0;
    const accessor = Object.defineProperty({
      projectileGeneration: flight.generation,
      segments: valid.segments,
    }, "projectileId", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return flight.instanceId;
      },
    });
    expect(() => override.cancelProjectilesAlongPaths(
      pool,
      [accessor] as unknown as Parameters<DirectionalOverrideAuthority["cancelProjectilesAlongPaths"]>[1],
      13,
    )).toThrow(/own enumerable data property/);
    expect(accessorReads).toBe(0);
    expect(override.snapshot()).toEqual(beforeWrongTick);

    let componentAccessorReads = 0;
    const componentBoundary = Object.defineProperty({
      from: {x: 1, y: 0},
      to: {x: 20, y: 0},
    }, "startsNewComponent", {
      enumerable: true,
      get() {
        componentAccessorReads += 1;
        return true;
      },
    });
    expect(() => override.cancelProjectilesAlongPaths(pool, [{
      projectileId: flight.instanceId,
      projectileGeneration: flight.generation,
      segments: [
        {from: {x: -20, y: 0}, to: {x: 0, y: 0}},
        componentBoundary,
      ],
    }] as unknown as Parameters<DirectionalOverrideAuthority["cancelProjectilesAlongPaths"]>[1], 13))
      .toThrow(/own enumerable data property/);
    expect(componentAccessorReads).toBe(0);
    expect(override.snapshot()).toEqual(beforeWrongTick);
  });

  it("does not replay a pre-activation projectile segment when the local void opens", () => {
    const bus = new CanonicalEventBus();
    const pool = makeProjectilePool(bus, "override-stale-sweep-pool");
    const priorCrossing = spawnProjectile(pool, "prior-crossing", -150, 0, 0, 10);
    pool.move(priorCrossing, 11, {x: 150, y: 0});
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "IN_BETWEEN"}, 0);
    override.advanceTo(12);

    expect(override.cancelProjectiles(pool, 12)).toEqual([]);
    expect(pool.snapshot(priorCrossing)).toMatchObject({
      state: "flight",
      collisionEnabled: true,
      previousPosition: {x: 150, y: 0},
      position: {x: 150, y: 0},
      movedAtTick120: 11,
    });
  });

  it("crosses active, sediment, and cooldown boundaries once under a large delta", () => {
    const bus = new CanonicalEventBus();
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "INFORMATION"}, 1);
    override.advanceTo(100_000);
    expect(override.snapshot().state).toBe("idle");
    const events = bus.flush();
    for (const id of [
      "player.override.commit",
      "player.override.local_void.open",
      "player.override.local_void.close",
      "player.override.material_sediment.begin",
      "player.override.cooldown.begin",
      "player.override.ready",
    ]) {
      expect(events.filter((event) => event.id === id)).toHaveLength(1);
    }
    expect(events.filter((event) => event.tick120 % 2 !== 0)).toHaveLength(1);
    expect(events.find((event) => event.tick120 % 2 !== 0)?.id).toBe("player.override.charge.begin");
  });

  it("does not advance or mutate when context is invalid", () => {
    const bus = new CanonicalEventBus();
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    const before = override.snapshot();
    expect(() => override.press({
      origin: {x: 0, y: 0},
      direction: {x: 0, y: 0},
      roomId: "INFORMATION",
    }, 500)).toThrow(/must be non-zero/);
    expect(override.snapshot()).toEqual(before);
    expect(evidence.amount).toBe(2);
    expect(bus.events()).toEqual([]);

    for (const roomId of ["INFO_OVERFLOW", "UNKNOWN_ROOM"]) {
      expect(() => override.press({
        origin: {x: 0, y: 0},
        direction: {x: 1, y: 0},
        roomId,
      }, 500)).toThrow(/canonical writable V4 room ID/);
      expect(override.snapshot()).toEqual(before);
    }
  });

  it("drains a zero-duration cycle once at an even boundary", () => {
    const bus = new CanonicalEventBus();
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {
      config: {
        ...FAST_OVERRIDE_CONFIG,
        chargeMs: 0,
        activeMs: 0,
        sedimentMs: 0,
        cooldownMs: 0,
      },
    });
    expect(override.press({
      origin: {x: 0, y: 0},
      direction: {x: 1, y: 0},
      roomId: "IN_BETWEEN",
    }, 2)).toBe(true);
    expect(override.snapshot().state).toBe("idle");
    expect(evidence.amount).toBe(0);
    const events = bus.flush();
    expect(events.filter((event) => event.tick120 !== 2)).toEqual([]);
    expect(events.filter((event) => event.id === "player.override.ready")).toHaveLength(1);
    expect(events.filter((event) => event.id === "cross_run.scar.write.commit")).toHaveLength(1);
    expect(override.overrideScars()[0]).toMatchObject({
      position: {x: 0, y: 0},
      cancellations: [],
    });
  });
});

describe("clock and render cadence parity", () => {
  function runCadence(deltas: readonly number[]): Readonly<{
    player: ReturnType<PlayerDamageAuthority["snapshot"]>;
    override: ReturnType<DirectionalOverrideAuthority["snapshot"]>;
    evidence: ReturnType<EvidenceAuthority["snapshot"]>;
    trace: string;
  }> {
    const bus = new CanonicalEventBus();
    const player = new PlayerDamageAuthority(bus, {config: FAST_DAMAGE_CONFIG});
    const evidence = new EvidenceAuthority(bus, 2);
    const override = new DirectionalOverrideAuthority(bus, evidence, {config: FAST_OVERRIDE_CONFIG});
    player.commitDamageBatch(0, [
      {occurrenceKey: "cadence-hit", sourceId: "projectile:cadence", amount: 1},
    ]);
    override.press({origin: {x: 0, y: 0}, direction: {x: 1, y: 0}, roomId: "IN_BETWEEN"}, 0);
    const clock = new AuthorityClock({
      onTick120(boundary) {
        player.advanceTo(boundary.tick120);
        override.advanceTo(boundary.tick120);
      },
    });
    for (const delta of deltas) {
      clock.advance(delta);
      bus.flush();
    }
    return Object.freeze({
      player: player.snapshot(),
      override: override.snapshot(),
      evidence: evidence.snapshot(),
      trace: bus.canonicalSerialization(),
    });
  }

  it("produces an identical trace under one large render chunk and many small chunks", () => {
    const single = runCadence([2500]);
    const chunked = runCadence(Array.from({length: 250}, () => 10));
    expect(chunked).toEqual(single);
    expect(single.player.tick120).toBe(300);
    expect(single.override.state).toBe("idle");
    expect(single.evidence.amount).toBe(0);
  });
});
