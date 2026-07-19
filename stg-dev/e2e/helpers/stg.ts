import {expect, type Page} from "@playwright/test";

/**
 * The entry point exports nothing. Its contract to this layer is the small,
 * deliberately stable observability surface it writes on <body>:
 *
 *   data-authority      — which authority is live
 *   data-authority-tick — where that authority is in gameplay time
 *   data-raw-run-seed   — which seed produced it
 *   data-mode           — which surface is mounted
 *   data-run-phase      — which authored narrative state it is in
 *
 * Nothing here may drive gameplay; every wait is on a fact the authority
 * published, never on an animation, a transition end or a wall-clock sleep.
 */
export const RUN_AUTHORITY = "run-conductor";

/**
 * Readiness. `data-authority` and `data-raw-run-seed` are written synchronously
 * by `startRun` — after the module-scope V4 content validation has passed and
 * before the first frame. Waiting on them means the application module is ready
 * and the boot button's handler is attached, without waiting on a frame (the
 * controlled-RAF harness deliberately produces none until it is stepped).
 */
export async function openApp(page: Page, path = "/"): Promise<void> {
  const response = await page.goto(path, {waitUntil: "domcontentloaded"});

  expect(response, `GET ${path} should return a document response`).not.toBeNull();
  expect(response?.ok(), `GET ${path} should succeed`).toBe(true);
  await expect(page).toHaveTitle(/1bit \/ STG/i);

  const body = page.locator("body");
  await expect(body).toHaveAttribute("data-authority", RUN_AUTHORITY);
  await expect(body).toHaveAttribute("data-mode", "run");
  await expect(body).toHaveAttribute("data-raw-run-seed", /^\d+$/u);
}

/**
 * The boot overlay fades out under a CSS transition and stays in the document.
 * Presentation never reports gameplay, so readiness is taken from the class the
 * entry point sets, never from the transition finishing.
 */
export async function enterSimulation(page: Page): Promise<void> {
  const overlay = page.locator("#boot-overlay");
  await expect(overlay).toBeVisible();
  await page.locator("#boot-button").click();
  await expect(overlay).toHaveClass(/\bleaving\b/);
}

export async function readClock(page: Page): Promise<number> {
  const raw = (await page.locator("#header-clock").textContent())?.trim() ?? "";
  const value = Number.parseFloat(raw);
  expect(Number.isFinite(value), `header clock should be numeric, received: ${raw}`).toBe(true);
  return value;
}

export async function waitForClockAfter(page: Page, previous: number): Promise<number> {
  await expect
    .poll(() => readClock(page), {
      message: `gameplay clock should advance beyond ${previous.toFixed(3)}s`,
      timeout: 10_000,
    })
    .toBeGreaterThan(previous + 0.025);
  return readClock(page);
}

export async function readAuthorityTick(page: Page): Promise<number> {
  const raw = await page.locator("body").getAttribute("data-authority-tick");
  const value = Number(raw);
  expect(Number.isSafeInteger(value), `authority tick should be an integer, received: ${raw}`)
    .toBe(true);
  return value;
}

// ---------------------------------------------------------------------------
// Controlled RAF harness
// ---------------------------------------------------------------------------

interface ControlledRafWindow extends Window {
  __stepControlledRaf(deltaMs: number): void;
}

/**
 * Replace the frame source with one the test drives. This does NOT inject time
 * into gameplay: the entry point still derives every tick120 from the wall
 * delta it is handed, and AuthorityClock still owns the boundary. It only makes
 * the wall deltas exact, so a journey is tick-identical instead of
 * wall-clock flaky. Must be installed before `page.goto`.
 */
export async function installControlledRaf(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // A page may install this more than once (a spec that reopens the app in a
    // loop). Init scripts accumulate, so without this guard a later copy would
    // replace requestAnimationFrame with its own empty callback map while
    // __stepControlledRaf still stepped the first copy's map — the frame source
    // would then be split in two and the page would silently never render.
    if ("__stepControlledRaf" in window) return;
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

export const MS_PER_TICK120 = 1000 / 120;

export async function stepRaf(page: Page, deltaMs: number): Promise<void> {
  await page.evaluate((delta) => {
    (window as ControlledRafWindow).__stepControlledRaf(delta);
  }, deltaMs);
}

/** Step exactly `ticks` tick120 of wall time in one frame. */
export async function stepTicks(page: Page, ticks: number): Promise<void> {
  await stepRaf(page, ticks * MS_PER_TICK120);
}

export async function openControlled(page: Page, path: string): Promise<void> {
  await installControlledRaf(page);
  await openApp(page, path);
}

/**
 * Enter the run under the controlled frame source. The interval that ends at
 * the first started frame has no prior gameplay sample and is discarded by the
 * bridge, so the run is at tick 0 after this returns.
 */
export async function beginControlledRun(page: Page): Promise<void> {
  await enterSimulation(page);
  await stepRaf(page, 0);
  await expect(page.locator("body")).toHaveAttribute("data-authority-tick", "0");
}

/**
 * Advance until the authority reports exactly `targetTick120`.
 *
 * AuthorityClock holds its wall budget as an exact nanosecond bigint and
 * carries the sub-tick residue between advances, so a frame of exactly one
 * tick's worth of milliseconds is not guaranteed to cross a boundary — the
 * residue decides. Tests therefore never assume a delta produced a tick: long
 * jumps are batched, and the last few ticks are walked by stepping just over
 * one tick (which can cross at most one boundary) until the AUTHORITY reports
 * the target. Nothing is injected into gameplay; this only reads back where
 * the authority actually is.
 */
export async function advanceControlledRunToTick(page: Page, targetTick120: number): Promise<void> {
  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    const currentTick120 = await readAuthorityTick(page);
    if (currentTick120 === targetTick120) return;
    if (currentTick120 > targetTick120) {
      throw new Error(`controlled RUN overshot tick ${targetTick120}: ${currentTick120}`);
    }
    const remainingTicks = targetTick120 - currentTick120;
    if (remainingTicks > 4) {
      await stepTicks(page, Math.min(800, remainingTicks - 2));
    } else {
      await stepRaf(page, MS_PER_TICK120);
    }
  }
  throw new Error(`controlled RUN did not reach tick ${targetTick120}`);
}

/** Advance exactly one authoritative tick, however many frames that takes. */
export async function advanceOneTick(page: Page): Promise<number> {
  const target = await readAuthorityTick(page) + 1;
  await advanceControlledRunToTick(page, target);
  return target;
}

/** Advance in whole-second batches until the authority reports `phase`. */
export async function advanceControlledRunToPhase(
  page: Page,
  phase: string,
  maxSeconds = 120,
): Promise<number> {
  const body = page.locator("body");
  for (let second = 0; second < maxSeconds; second += 1) {
    if (await body.getAttribute("data-run-phase") === phase) return readAuthorityTick(page);
    await advanceControlledRunToTick(page, await readAuthorityTick(page) + 120);
  }
  throw new Error(
    `controlled RUN did not reach ${phase} within ${maxSeconds}s `
    + `(last observed: ${await body.getAttribute("data-run-phase")})`,
  );
}

/**
 * Toggle an accessibility switch the way a player does. The checkbox itself is
 * covered by the label's own rendering, so the visible switch is clicked and
 * the result is confirmed from the checkbox's own state.
 */
export async function setAccessibilitySwitch(
  page: Page,
  id: "reduced-motion" | "flash-off" | "audio-enabled",
  enabled: boolean,
): Promise<void> {
  const input = page.locator(`#${id}`);
  if (await input.isChecked() === enabled) return;
  await page.locator(`label.switch-row:has(#${id}) i`).click();
  await expect(input).toBeChecked({checked: enabled});
}

/**
 * One meaningful input rising edge, as the authority counts it: movement, focus
 * or gaze intent. A signal press is deliberately NOT one — the authored
 * awakening guard counts `player.meaningfulInputCount`, which the conductor
 * raises on movement/focus/gaze only.
 */
export async function pressMeaningfulInput(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await stepRaf(page, 0);
  await advanceOneTick(page);
  await page.keyboard.up(key);
  await stepRaf(page, 0);
  await advanceOneTick(page);
}
