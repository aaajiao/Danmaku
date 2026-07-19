import {expect, test, type Page} from "@playwright/test";
import {PATTERN_COUNT} from "./helpers/stg";

interface ControlledRafWindow extends Window {
  __stepControlledRaf(deltaMs: number): void;
}

async function installControlledRaf(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let nextId = 1;
    let now: number | null = null;
    const callbacks = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id: number): void => {
      callbacks.delete(id);
    };
    Object.defineProperty(window, "__stepControlledRaf", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (deltaMs: number): void => {
        if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error("invalid controlled RAF delta");
        if (now === null) now = performance.now();
        now += deltaMs;
        const due = [...callbacks.values()];
        callbacks.clear();
        for (const callback of due) callback(now);
      },
    });
  });
}

async function stepRaf(page: Page, deltaMs: number): Promise<void> {
  await page.evaluate((delta) => {
    (window as ControlledRafWindow).__stepControlledRaf(delta);
  }, deltaMs);
}

async function openControlled(page: Page, path: string): Promise<void> {
  await installControlledRaf(page);
  const response = await page.goto(path, {waitUntil: "domcontentloaded"});
  expect(response?.ok(), `GET ${path} should succeed`).toBe(true);
  await expect(page.locator("#pattern-select option")).toHaveCount(PATTERN_COUNT);
}

async function advanceControlledRunToTick(page: Page, targetTick120: number): Promise<void> {
  const body = page.locator("body");
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const currentTick120 = Number(await body.getAttribute("data-authority-tick"));
    if (currentTick120 === targetTick120) return;
    if (!Number.isSafeInteger(currentTick120) || currentTick120 > targetTick120) {
      throw new Error(`controlled RUN overshot tick ${targetTick120}: ${currentTick120}`);
    }
    const remainingTicks = targetTick120 - currentTick120;
    if (remainingTicks > 4) {
      const batchTicks = Math.min(800, remainingTicks - 2);
      await stepRaf(page, batchTicks * 1000 / 120);
    } else {
      await stepRaf(page, 8.4);
    }
  }
  throw new Error(`controlled RUN did not reach tick ${targetTick120}`);
}

test("RUN samples forward across boot, backlog, pause, and Focus boundaries", async ({page}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openControlled(page, "/?seed=305419896");
  const body = page.locator("body");

  await page.locator("#boot-button").click();
  await page.waitForTimeout(600);
  await stepRaf(page, 0);
  await expect(body).toHaveAttribute("data-authority-tick", "0");
  await expect.poll(async () => page.locator("#expression-meter").evaluate(
    (node) => (node as HTMLElement).style.width,
  )).toBe("30%");

  await stepRaf(page, 100);
  await expect(body).toHaveAttribute("data-authority-tick", "12");

  for (let edge = 1; edge <= 2; edge += 1) {
    await page.keyboard.down("z");
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
    await expect(body).toHaveAttribute("data-meaningful-inputs", String(edge));
    await expect(body).toHaveAttribute("data-signal-inputs", String(edge));
    await page.keyboard.up("z");
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
  }

  await page.keyboard.press("Space");
  await stepRaf(page, 8.4);
  await expect(body).toHaveAttribute("data-authority-tick", "17");
  await expect(body).toHaveClass(/\bpaused\b/);
  await stepRaf(page, 1000);
  await expect(body).toHaveAttribute("data-authority-tick", "17");

  await page.keyboard.press("Space");
  await stepRaf(page, 1000);
  await expect(body).toHaveAttribute("data-authority-tick", "17");
  await expect(body).not.toHaveClass(/\bpaused\b/);
  await stepRaf(page, 8.4);
  await expect(body).toHaveAttribute("data-authority-tick", "18");

  await page.keyboard.down("z");
  await page.keyboard.down("Shift");
  await page.keyboard.down("g");
  await stepRaf(page, 10_000);
  await expect(body).toHaveAttribute("data-authority-tick", "1042");
  await expect(body).toHaveAttribute("data-run-phase", "first_eye");
  await expect(body).toHaveAttribute("data-gaze-state", "idle");
  await expect(body).toHaveAttribute("data-gaze-clamp-committed", "false");
  await expect.poll(async () => page.locator("#expression-meter").evaluate(
    (node) => (node as HTMLElement).style.width,
  )).toBe("30%");
  await stepRaf(page, 0);
  await expect(body).toHaveAttribute("data-authority-tick", "1218");
  await expect(body).toHaveAttribute("data-gaze-state", "idle");
  await stepRaf(page, 8.4);
  await expect(body).toHaveAttribute("data-authority-tick", "1219");
  await expect(body).toHaveAttribute("data-gaze-state", "acquiring");
  await expect.poll(async () => page.locator("#expression-meter").evaluate(
    (node) => (node as HTMLElement).style.width,
  )).toBe("35%");
  await page.keyboard.up("Shift");
  await page.keyboard.up("g");
  await page.keyboard.up("z");

  expect(pageErrors, "controlled RUN should have no uncaught page errors").toEqual([]);
});

test("first room hands through two occurrences into retained material", async ({page}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const gazeHoldResponses: number[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (
      response.request().method() === "GET"
      && /\/assets\/gaze-hold-pulse-[^/]+\.wav$/u.test(pathname)
    ) {
      gazeHoldResponses.push(response.status());
    }
  });
  // Seed 1 formally selects the currently admitted notch_e successor. Seeds
  // that select an unsupported/pool-unmapped plan remain typed-withheld and
  // must not be rerolled merely to make this success-path scenario pass.
  await openControlled(page, "/?seed=1");
  const body = page.locator("body");
  const canvas = page.locator("#game-canvas");

  await page.locator("#boot-button").click();
  await page.waitForTimeout(600);
  await stepRaf(page, 0);

  await page.keyboard.down("z");
  await stepRaf(page, 0);
  await stepRaf(page, 8.4);
  await page.keyboard.up("z");
  await stepRaf(page, 0);
  await stepRaf(page, 8.4);
  await page.keyboard.down("d");
  await stepRaf(page, 0);
  await stepRaf(page, 8.4);
  await advanceControlledRunToTick(page, 960);
  await expect(body).toHaveAttribute("data-run-phase", "first_eye");
  await expect(canvas).toHaveAttribute("data-presented-target-frame", "eye.reveal");
  await page.keyboard.up("d");
  await stepRaf(page, 0);

  await page.keyboard.down("g");
  await stepRaf(page, 0);
  await advanceControlledRunToTick(page, 1021);
  await expect(body).toHaveAttribute("data-run-phase", "first_clamp_recovery");
  await expect(canvas).toHaveAttribute("data-presented-target-frame", "eye.clamp");
  await expect(body).toHaveAttribute("data-last-canonical-feedback-event", "gaze.clamp.commit");
  await expect(body).toHaveAttribute("data-last-canonical-feedback-audio", "sfx.gaze_hold_pulse");
  await expect(body).toHaveAttribute(
    "data-last-canonical-feedback-audio-key",
    "gaze-clamp-audio:gaze:1:clamp",
  );
  await expect(body).toHaveAttribute("data-last-canonical-feedback-haptic", "0:24:0.55");
  await expect(body).toHaveAttribute(
    "data-last-canonical-feedback-haptic-key",
    "gaze-clamp-haptic:gaze:1:clamp",
  );
  await expect(body).toHaveAttribute("data-canonical-haptic-dispatches", "1");
  await expect.poll(() => gazeHoldResponses.length).toBe(1);
  expect([200, 206]).toContain(gazeHoldResponses[0]);
  await page.keyboard.up("g");
  await stepRaf(page, 0);
  await advanceControlledRunToTick(page, 1075);
  await expect(body).toHaveAttribute("data-gaze-clamp-released", "false");
  await expect(body).toHaveAttribute("data-flower-recovery-complete", "false");
  await expect(canvas).toHaveAttribute("data-presented-target-frame", "eye.clamp");
  await advanceControlledRunToTick(page, 1076);
  await expect(body).toHaveAttribute("data-gaze-clamp-released", "true");
  await expect(body).toHaveAttribute("data-flower-recovery-complete", "false");
  await expect(canvas).toHaveAttribute("data-presented-target-frame", "eye.withdraw");
  await advanceControlledRunToTick(page, 1106);
  await expect(body).toHaveAttribute("data-gaze-clamp-released", "true");
  await expect(body).toHaveAttribute("data-flower-recovery-complete", "true");
  await expect(canvas).toHaveAttribute("data-presented-target-frame", "eye.withdraw");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await body.getAttribute("data-run-phase") === "room_sampling") break;
    const currentTick120 = Number(await body.getAttribute("data-authority-tick"));
    await advanceControlledRunToTick(page, currentTick120 + 120);
  }
  await expect(body).toHaveAttribute("data-run-phase", "room_sampling");
  const handoffTick120 = Number(await body.getAttribute("data-room-start-tick"));
  expect(handoffTick120).toBeGreaterThan(0);

  await advanceControlledRunToTick(page, handoffTick120 + 1587);
  await page.keyboard.down("a");
  await stepRaf(page, 0);
  await advanceControlledRunToTick(page, handoffTick120 + 1701);
  await expect(body).toHaveAttribute("data-room-complete", "false");
  await expect(body).toHaveAttribute("data-room-handoff-ready", "false");
  await expect(body).toHaveAttribute("data-projectile-entities", "0");
  await expect(body).toHaveAttribute("data-live-colliders", "0");
  await expect(body).toHaveAttribute("data-residue-visuals", "0");

  await advanceControlledRunToTick(page, handoffTick120 + 1702);
  await expect(body).toHaveAttribute("data-room-complete", "true");
  await expect(body).toHaveAttribute("data-room-handoff-ready", "false");
  await expect(body).toHaveAttribute("data-handoff-ready", "true");

  const flowerAuthorityTick = await body.getAttribute("data-flower-authority-tick");
  const gazeAuthorityTick = await body.getAttribute("data-gaze-authority-tick");
  const expressionWidth = await page.locator("#expression-meter").evaluate(
    (node) => (node as HTMLElement).style.width,
  );
  const playerX = Number(await body.getAttribute("data-player-x"));
  await page.keyboard.down("Shift");
  await page.keyboard.down("z");
  await page.keyboard.down("g");
  await stepRaf(page, 0);
  await advanceControlledRunToTick(page, handoffTick120 + 1703);
  await expect(body).toHaveAttribute("data-run-phase", "first_continuation_transition");
  await expect(body).toHaveAttribute("data-authority-owner", "first_continuation_transition");
  await expect(body).toHaveAttribute("data-transition-present", "true");
  await expect(body).toHaveAttribute("data-transition-phase", "transition_gameplay");
  await expect(body).toHaveAttribute("data-transition-pattern-id", "transition.room_threshold");
  await expect(body).toHaveAttribute(
    "data-transition-occurrence-id",
    "run:room:0-to-1:transition:transition.room_threshold",
  );
  await expect(body).toHaveAttribute("data-transition-world-room", "FORCED_ALIGNMENT");
  await expect(body).toHaveAttribute("data-room-id", "FORCED_ALIGNMENT");
  await expect(body).toHaveAttribute("data-room-pattern-id", "transition.room_threshold");
  await expect(body).toHaveAttribute("data-room-difficulty", "NORMAL");
  await expect(body).toHaveAttribute("data-room-composer", "");
  await expect(body).toHaveAttribute("data-player-focused", "true");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-pattern-id",
    "transition.room_threshold",
  );
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-room",
    "FORCED_ALIGNMENT",
  );
  await expect(page.locator("#room-value")).toHaveText("FORCED ALIGNMENT");
  expect(Number(await body.getAttribute("data-player-x"))).toBeLessThan(playerX);
  await expect(body).toHaveAttribute("data-flower-authority-tick", flowerAuthorityTick ?? "");
  await expect(body).toHaveAttribute("data-gaze-authority-tick", gazeAuthorityTick ?? "");
  await expect.poll(() => page.locator("#expression-meter").evaluate(
    (node) => (node as HTMLElement).style.width,
  )).toBe(expressionWidth);

  const transitionStartTick120 = Number(await body.getAttribute("data-transition-start-tick"));
  const worldSwapTick120 = Number(await body.getAttribute("data-transition-world-swap-tick"));
  const completeTick120 = Number(await body.getAttribute("data-transition-complete-tick"));
  const patternCompleteTick120 = Number(
    await body.getAttribute("data-transition-pattern-complete-tick"),
  );
  const targetRoom = await body.getAttribute("data-transition-target-room");
  expect(transitionStartTick120).toBe(handoffTick120 + 1703);
  expect(worldSwapTick120).toBeGreaterThan(transitionStartTick120);
  expect(completeTick120).toBeGreaterThan(worldSwapTick120);
  expect(patternCompleteTick120).toBeGreaterThan(completeTick120);
  expect(targetRoom).toBe("IN_BETWEEN");
  await expect(canvas).toHaveAttribute(
    "data-presented-room-threshold-frame",
    "threshold.in_between",
  );

  await page.keyboard.up("a");
  await page.keyboard.up("Shift");
  await stepRaf(page, 0);
  await advanceControlledRunToTick(page, worldSwapTick120 - 1);
  await expect(body).toHaveAttribute("data-transition-world-room", "FORCED_ALIGNMENT");
  await expect(body).toHaveAttribute("data-transition-collision-lease-released", "false");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-room",
    "FORCED_ALIGNMENT",
  );
  await expect(canvas).toHaveAttribute(
    "data-presented-room-threshold-frame",
    "threshold.in_between",
  );
  await expect(page.locator("#room-value")).toHaveText("FORCED ALIGNMENT");
  await advanceControlledRunToTick(page, worldSwapTick120);
  await expect(body).toHaveAttribute("data-transition-world-room", targetRoom ?? "");
  await expect(body).toHaveAttribute("data-room-id", targetRoom ?? "");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-room",
    targetRoom ?? "",
  );
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-pattern-id",
    "transition.room_threshold",
  );
  await expect(canvas).toHaveAttribute(
    "data-presented-room-threshold-frame",
    "threshold.in_between",
  );
  await expect(page.locator("#room-value")).toHaveText(
    (targetRoom ?? "").replaceAll("_", " "),
  );

  await advanceControlledRunToTick(page, completeTick120 - 1);
  await expect(body).toHaveAttribute("data-transition-collision-lease-released", "false");
  await expect(canvas).toHaveAttribute(
    "data-presented-room-threshold-frame",
    "threshold.in_between",
  );
  await advanceControlledRunToTick(page, completeTick120);
  await expect(body).toHaveAttribute("data-transition-collision-lease-released", "true");
  await expect(canvas).toHaveAttribute("data-presented-room-threshold-frame", "");

  await advanceControlledRunToTick(page, transitionStartTick120 + 100);
  expect(Number(await body.getAttribute("data-projectile-entities"))).toBeGreaterThan(0);
  expect(Number(await body.getAttribute("data-live-colliders"))).toBeGreaterThan(0);

  await advanceControlledRunToTick(page, patternCompleteTick120 - 1);
  await expect(body).toHaveAttribute("data-transition-phase", "transition_gameplay");
  await expect(body).toHaveAttribute("data-transition-material-count", "");
  await expect(body).toHaveAttribute("data-transition-handoff-ready", "false");
  await advanceControlledRunToTick(page, patternCompleteTick120);
  await expect(body).toHaveAttribute("data-transition-phase", "material_carryover");
  expect(Number(await body.getAttribute("data-transition-material-count"))).toBeGreaterThan(0);
  await expect(body).toHaveAttribute("data-live-colliders", "0");
  await expect(body).toHaveAttribute("data-transition-handoff-ready", "true");
  await expect(body).toHaveAttribute(
    "data-transition-handoff-state",
    "ready-pending-room-plan-and-combined-pool-budget",
  );
  await expect(body).toHaveAttribute(
    "data-transition-next-room-admission",
    "withheld-pending-room-plan-and-combined-pool-budget",
  );
  await expect(body).toHaveAttribute("data-run-phase", "first_continuation_room");
  await expect(body).toHaveAttribute("data-authority-owner", "first_continuation_room_pre_read");
  await expect(body).toHaveAttribute("data-successor-present", "true");
  await expect(body).toHaveAttribute("data-successor-stage", "first-occurrence");
  await expect(body).toHaveAttribute("data-successor-phase", "dormant");
  await expect(body).toHaveAttribute("data-successor-admission-withheld-reason", "");
  const successorPatternId = await body.getAttribute("data-successor-pattern-id");
  expect(successorPatternId).toBeTruthy();
  await expect(body).toHaveAttribute("data-room-pattern-id", successorPatternId ?? "");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-pattern-id",
    successorPatternId ?? "",
  );
  expect(Number(await body.getAttribute("data-projectile-entities"))).toBe(
    Number(await body.getAttribute("data-transition-material-count")),
  );
  await expect(body).toHaveAttribute(
    "data-successor-material-count",
    await body.getAttribute("data-transition-material-count") ?? "",
  );
  await advanceControlledRunToTick(page, patternCompleteTick120 + 1);
  await expect(body).toHaveAttribute("data-successor-phase", "telegraph");
  await expect(body).toHaveAttribute("data-authority-owner", "first_continuation_room_pre_read");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-pattern-id",
    successorPatternId ?? "",
  );
  await expect(body).toHaveAttribute("data-flower-authority-tick", flowerAuthorityTick ?? "");
  await expect(body).toHaveAttribute("data-gaze-authority-tick", gazeAuthorityTick ?? "");
  await expect.poll(() => page.locator("#expression-meter").evaluate(
    (node) => (node as HTMLElement).style.width,
  )).toBe(expressionWidth);
  await page.keyboard.up("z");
  await page.keyboard.up("g");
  await stepRaf(page, 0);

  const firstSliceCompleteTick120 = Number(
    await body.getAttribute("data-successor-slice-complete-tick"),
  );
  expect(firstSliceCompleteTick120).toBeGreaterThan(patternCompleteTick120 + 1);
  await advanceControlledRunToTick(page, firstSliceCompleteTick120 - 1);
  await expect(body).toHaveAttribute("data-successor-stage", "first-occurrence");
  await expect(body).toHaveAttribute("data-authority-owner", "first_continuation_room_tail");
  const firstCloseProjectileCount = Number(
    await body.getAttribute("data-projectile-entities"),
  );
  expect(firstCloseProjectileCount).toBeGreaterThan(0);

  await advanceControlledRunToTick(page, firstSliceCompleteTick120);
  await expect(body).toHaveAttribute("data-successor-stage", "second-occurrence");
  await expect(body).toHaveAttribute("data-successor-phase", "dormant");
  await expect(body).toHaveAttribute(
    "data-authority-owner",
    "first_continuation_room_second_pre_read",
  );
  await expect(body).toHaveAttribute(
    "data-successor-pattern-id",
    "room.in_between.misregistration_corridor",
  );
  await expect(body).toHaveAttribute("data-transition-material-count", "0");
  await expect(body).toHaveAttribute("data-transition-material-drained", "true");
  expect(Number(await body.getAttribute("data-successor-material-count"))).toBeGreaterThan(0);
  expect(Number(await body.getAttribute("data-projectile-entities"))).toBe(
    firstCloseProjectileCount,
  );
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-presented-pattern-id",
    "room.in_between.misregistration_corridor",
  );

  const secondReadStartTick120 = Number(await body.getAttribute("data-room-read-start-tick"));
  await advanceControlledRunToTick(page, secondReadStartTick120);
  await expect(body).toHaveAttribute("data-successor-stage", "second-occurrence");
  await expect(body).toHaveAttribute("data-successor-phase", "read");
  await expect(body).toHaveAttribute(
    "data-authority-owner",
    "first_continuation_room_second_pattern",
  );
  await expect(body).toHaveAttribute("data-room-combat-present", "true");

  const secondSliceCompleteTick120 = Number(
    await body.getAttribute("data-successor-slice-complete-tick"),
  );
  await advanceControlledRunToTick(page, secondSliceCompleteTick120 - 1);
  await expect(body).toHaveAttribute("data-successor-stage", "second-occurrence");
  await expect(body).toHaveAttribute("data-authority-owner", "first_continuation_room_second_tail");
  const secondCloseProjectileCount = Number(
    await body.getAttribute("data-projectile-entities"),
  );
  const patternTimeBeforeSecondClose = Number(await page.locator("#pattern-time").textContent());
  expect(secondCloseProjectileCount).toBeGreaterThan(0);

  await advanceControlledRunToTick(page, secondSliceCompleteTick120);
  await expect(body).toHaveAttribute("data-successor-stage", "second-material");
  await expect(body).toHaveAttribute("data-successor-phase", "material-hold");
  await expect(body).toHaveAttribute(
    "data-authority-owner",
    "first_continuation_room_second_material",
  );
  await expect(body).toHaveAttribute("data-room-combat-present", "false");
  await expect(body).toHaveAttribute("data-successor-room-completion", "withheld");
  await expect(body).toHaveAttribute("data-successor-room-handoff", "withheld");
  expect(Number(await body.getAttribute("data-projectile-entities"))).toBe(
    secondCloseProjectileCount,
  );
  expect(Number(await page.locator("#pattern-time").textContent()))
    .toBeGreaterThan(patternTimeBeforeSecondClose);

  await advanceControlledRunToTick(page, 8_682);
  await expect(body).toHaveAttribute("data-successor-stage", "second-material");
  await expect(body).toHaveAttribute("data-successor-material-count", "0");
  await expect(body).toHaveAttribute("data-successor-material-drained", "true");
  await expect(body).toHaveAttribute("data-projectile-entities", "0");
  await advanceControlledRunToTick(page, 8_683);
  await expect(body).toHaveAttribute("data-run-phase", "first_continuation_room");
  await expect(body).toHaveAttribute("data-successor-stage", "second-material");
  await expect(body).toHaveAttribute("data-successor-material-allocated-micro", "80");
  await expect(body).toHaveAttribute("data-successor-room-completion", "withheld");
  await expect(body).toHaveAttribute("data-successor-room-handoff", "withheld");
  expect(gazeHoldResponses).toHaveLength(1);
  expect([200, 206]).toContain(gazeHoldResponses[0]);
  await expect(body).toHaveAttribute("data-canonical-haptic-dispatches", "1");

  expect(pageErrors, "controlled first-room closure should have no uncaught errors").toEqual([]);
  expect(consoleErrors, "controlled transition should have no console errors").toEqual([]);
});

test("pause preserves the pre-pause sample while retained backlog drains", async ({page}) => {
  await openControlled(page, "/?seed=305419896");
  const body = page.locator("body");
  const expression = page.locator("#expression-meter");

  await page.locator("#boot-button").click();
  await page.waitForTimeout(600);
  await stepRaf(page, 0);
  await expect(body).toHaveAttribute("data-authority-tick", "0");
  await expect.poll(() => expression.evaluate((node) => (node as HTMLElement).style.width)).toBe("30%");

  await page.keyboard.down("z");
  await stepRaf(page, 0);
  await stepRaf(page, 8.4);
  await expect(body).toHaveAttribute("data-authority-tick", "1");
  await expect(body).toHaveAttribute("data-signal-inputs", "1");
  await expect.poll(() => expression.evaluate((node) => (node as HTMLElement).style.width)).toBe("50%");

  await page.keyboard.press("Space");
  await stepRaf(page, 10_000);
  await expect(body).toHaveAttribute("data-authority-tick", "1025");
  await expect(body).toHaveAttribute("data-clock-backlog", "176");
  await expect(body).toHaveClass(/\bpaused\b/);
  await expect.poll(() => expression.evaluate((node) => (node as HTMLElement).style.width)).toBe("50%");

  await stepRaf(page, 1_000);
  await expect(body).toHaveAttribute("data-authority-tick", "1025");
  await expect(body).toHaveAttribute("data-clock-backlog", "176");

  await page.keyboard.press("Space");
  await stepRaf(page, 1_000);
  await expect(body).not.toHaveClass(/\bpaused\b/);
  await expect(body).toHaveAttribute("data-authority-tick", "1025");
  await stepRaf(page, 0);
  await expect(body).toHaveAttribute("data-authority-tick", "1201");
  await expect(body).toHaveAttribute("data-clock-backlog", "0");
  await expect.poll(() => expression.evaluate((node) => (node as HTMLElement).style.width)).toBe("50%");

  await page.keyboard.up("z");
  await stepRaf(page, 0);
  await stepRaf(page, 8.4);
  await expect(body).toHaveAttribute("data-authority-tick", "1202");
  await expect.poll(() => expression.evaluate((node) => (node as HTMLElement).style.width)).toBe("30%");
});

test("full, reduced-motion, and flash-off project one authority trace", async ({page}) => {
  await installControlledRaf(page);
  const traces: Record<string, unknown>[] = [];

  for (const profile of ["full", "reduced-motion", "flash-off"] as const) {
    const response = await page.goto(`/?seed=305419896&profile=${profile}`, {waitUntil: "domcontentloaded"});
    expect(response?.ok()).toBe(true);
    await expect(page.locator("#pattern-select option")).toHaveCount(PATTERN_COUNT);
    await page.locator("#boot-button").click();
    await page.waitForTimeout(600);
    await stepRaf(page, 0);

    await page.keyboard.down("z");
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
    await page.keyboard.up("z");
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
    await page.keyboard.down("d");
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
    await stepRaf(page, 8_000);
    await expect(page.locator("body")).toHaveAttribute("data-run-phase", "first_eye");
    await page.keyboard.down("g");
    await stepRaf(page, 0);
    await stepRaf(page, 510);
    await expect(page.locator("body")).toHaveAttribute("data-run-phase", "first_clamp_recovery");
    await page.keyboard.up("g");
    await stepRaf(page, 0);
    await stepRaf(page, 710);

    const body = page.locator("body");
    await expect(body).toHaveAttribute("data-presentation-profile", profile);
    await expect(body).toHaveAttribute("data-reduced-motion", String(profile === "reduced-motion"));
    await expect(body).toHaveAttribute("data-flash-off", String(profile === "flash-off"));
    await expect(body).toHaveAttribute("data-gaze-clamp-released", "true");
    await expect(body).toHaveAttribute("data-flower-recovery-complete", "true");
    traces.push(await page.evaluate(() => ({
      tick120: document.body.dataset.authorityTick,
      phase: document.body.dataset.runPhase,
      meaningfulInputs: document.body.dataset.meaningfulInputs,
      signalInputs: document.body.dataset.signalInputs,
      liveColliders: document.body.dataset.liveColliders,
      handoffReady: document.body.dataset.handoffReady,
      handoffState: document.body.dataset.handoffState,
      handoffTarget: document.body.dataset.handoffTarget,
      gazeState: document.body.dataset.gazeState,
      gazeClampReleased: document.body.dataset.gazeClampReleased,
      flowerRecoveryComplete: document.body.dataset.flowerRecoveryComplete,
      eventTrace: [...document.querySelectorAll("#event-log li")].map((item) => ({
        type: (item as HTMLElement).dataset.type,
        text: item.textContent,
      })),
    })));
    await page.keyboard.up("d");
  }

  expect(traces[1]).toEqual(traces[0]);
  expect(traces[2]).toEqual(traces[0]);
});

test("one touch contact contributes one device-neutral meaningful fact", async ({browser, baseURL}) => {
  expect(baseURL).toBeTruthy();
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: {width: 900, height: 900},
  });
  try {
    const page = await context.newPage();
    await openControlled(page, "/?seed=305419896");
    const body = page.locator("body");
    await page.locator("#boot-button").click();
    await page.waitForTimeout(600);
    await stepRaf(page, 0);

    const box = await page.locator("#game-canvas").boundingBox();
    expect(box).not.toBeNull();
    const client = await context.newCDPSession(page);
    const touchPoint = {
      x: (box?.x ?? 0) + (box?.width ?? 360) * 0.8,
      y: (box?.y ?? 0) + (box?.height ?? 640) * 0.2,
      radiusX: 1,
      radiusY: 1,
      force: 1,
      id: 1,
    };

    await client.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [touchPoint]});
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
    await expect(body).toHaveAttribute("data-authority-tick", "1");
    await expect(body).toHaveAttribute("data-meaningful-inputs", "1");
    await expect(body).toHaveAttribute("data-signal-inputs", "1");

    await client.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{...touchPoint, id: 2}],
    });
    await stepRaf(page, 0);
    await stepRaf(page, 8.4);
    await expect(body).toHaveAttribute("data-authority-tick", "3");
    await expect(body).toHaveAttribute("data-meaningful-inputs", "2");
    await expect(body).toHaveAttribute("data-signal-inputs", "2");
    await client.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
  } finally {
    await context.close();
  }
});

test("Pattern Lab reconciles one held Override edge at the start boundary", async ({page}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openControlled(page, "/?mode=pattern-lab");

  await page.keyboard.down("x");
  await stepRaf(page, 0);
  await page.locator("#boot-button").click();
  await page.waitForTimeout(600);
  await stepRaf(page, 0);
  await expect(page.locator("#header-clock")).toHaveText("000.000");
  await stepRaf(page, 8.4);
  await expect(page.locator('#event-log li[data-type="override-denied"]')).toHaveCount(1);
  await page.keyboard.up("x");

  expect(pageErrors, "controlled Pattern Lab should have no uncaught page errors").toEqual([]);
});

test("RUN projects only the manifest signal glyph after its 60-second guard", async ({page}) => {
  await openControlled(page, "/?seed=305419896");
  const body = page.locator("body");
  const fallback = page.locator("#signal-fallback");

  await page.locator("#boot-button").click();
  await page.waitForTimeout(600);
  await stepRaf(page, 0);
  await stepRaf(page, 60_000);
  for (let drain = 0; drain < 7; drain += 1) await stepRaf(page, 0);

  await expect(body).toHaveAttribute("data-authority-tick", "7200");
  await expect(body).toHaveAttribute("data-run-phase", "quiet_awakening");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveText("[发出信号]");
  await expect(fallback).toHaveAttribute("title", "[SIGNAL]");

  await page.keyboard.down("z");
  await stepRaf(page, 0);
  await stepRaf(page, 8.4);
  await expect(body).toHaveAttribute("data-signal-inputs", "1");
  await expect(fallback).toBeHidden();
  await page.keyboard.up("z");
});
