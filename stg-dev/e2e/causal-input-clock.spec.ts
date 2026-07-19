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

test("first fixed room closure commits only at H+1702", async ({page}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openControlled(page, "/?seed=305419896");
  const body = page.locator("body");

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
  await page.keyboard.up("d");
  await stepRaf(page, 0);

  await page.keyboard.down("g");
  await stepRaf(page, 0);
  await advanceControlledRunToTick(page, 1021);
  await expect(body).toHaveAttribute("data-run-phase", "first_clamp_recovery");
  await page.keyboard.up("g");
  await stepRaf(page, 0);
  await advanceControlledRunToTick(page, 1106);
  await expect(body).toHaveAttribute("data-gaze-clamp-released", "true");
  await expect(body).toHaveAttribute("data-flower-recovery-complete", "true");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await body.getAttribute("data-run-phase") === "room_sampling") break;
    const currentTick120 = Number(await body.getAttribute("data-authority-tick"));
    await advanceControlledRunToTick(page, currentTick120 + 120);
  }
  await expect(body).toHaveAttribute("data-run-phase", "room_sampling");
  const handoffTick120 = Number(await body.getAttribute("data-room-start-tick"));
  expect(handoffTick120).toBeGreaterThan(0);

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

  await advanceControlledRunToTick(page, handoffTick120 + 1703);
  await expect(body).toHaveAttribute("data-room-complete", "true");
  await expect(body).toHaveAttribute("data-room-handoff-ready", "false");
  expect(pageErrors, "controlled first-room closure should have no uncaught errors").toEqual([]);
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
