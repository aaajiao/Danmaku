import {expect, test} from "@playwright/test";
import {enterSimulation, PATTERN_COUNT} from "./helpers/stg";

const FIXED_ENCOUNTER_SEED = 0x1234_5678;

test("default RUN drains combat but remains at the unqualified gaze barrier", async ({page}) => {
  test.setTimeout(45_000);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const path = `/?seed=${FIXED_ENCOUNTER_SEED}`;
  const response = await page.goto(path, {waitUntil: "domcontentloaded"});
  expect(response, `GET ${path} should return a document response`).not.toBeNull();
  expect(response?.ok(), `GET ${path} should succeed`).toBe(true);
  await expect(page).toHaveTitle("1bit / STG RUN 04");
  await expect(page.locator("#pattern-select option")).toHaveCount(PATTERN_COUNT);

  const body = page.locator("body");
  await expect(body).toHaveAttribute("data-mode", "run");
  await expect(body).toHaveAttribute("data-authority", "canonical-run-session-v4");
  await expect(body).toHaveAttribute("data-run-phase", "quiet_awakening");
  await expect(body).toHaveAttribute("data-authority-tick", "0");
  await expect(body).toHaveAttribute("data-live-colliders", "0");
  await expect(body).toHaveAttribute("data-meaningful-inputs", "0");
  await expect(body).toHaveAttribute("data-signal-inputs", "0");
  await expect(body).toHaveAttribute("data-handoff-ready", "false");
  await expect(body).toHaveAttribute("data-gaze-state", "idle");
  await expect(body).toHaveAttribute("data-gaze-clamp-committed", "false");
  await expect(body).toHaveAttribute("data-gaze-clamp-released", "false");
  await expect(body).toHaveAttribute("data-flower-recovery-complete", "false");
  await expect(page.locator(".controls-strip")).toBeHidden();
  await expect(page.locator(".lab-panel")).toBeHidden();
  await expect(page.locator("#warning")).toBeHidden();
  await expect(page.locator("#boot-action-label")).toHaveText("从没有留痕的条件开始");
  await expect(page.locator("#boot-button")).toHaveAttribute("title", "BEGIN WITHOUT RETAINED MATTER");
  await expect(page.locator("#boot-heading")).toBeHidden();
  await expect(page.locator("#boot-meta")).toBeHidden();
  await expect(page.locator("#signal-fallback")).toBeHidden();
  await expect(page.locator("#pattern-intent")).toBeEmpty();
  await expect(page.locator("#seed-value")).toHaveText("12345678");

  await enterSimulation(page);

  await expect
    .poll(async () => Number(await body.getAttribute("data-authority-tick")))
    .toBeGreaterThan(4);
  await page.keyboard.press("Space");
  await expect(body).toHaveClass(/\bpaused\b/);
  const frozenTick = Number(await body.getAttribute("data-authority-tick"));
  await page.waitForTimeout(350);
  await expect(body).toHaveAttribute("data-authority-tick", String(frozenTick));
  await page.keyboard.press("Space");
  await expect(body).not.toHaveClass(/\bpaused\b/);
  await expect
    .poll(async () => Number(await body.getAttribute("data-authority-tick")))
    .toBeGreaterThan(frozenTick);

  await page.keyboard.down("d");
  await expect(body).toHaveAttribute("data-meaningful-inputs", "1");
  await page.keyboard.up("d");
  await expect.poll(async () => Number(await body.getAttribute("data-authority-tick")))
    .toBeGreaterThan(frozenTick + 2);
  await page.keyboard.down("z");
  await expect(body).toHaveAttribute("data-meaningful-inputs", "2");
  await expect(body).toHaveAttribute("data-signal-inputs", "1");
  await expect.poll(async () => page.locator("#expression-meter").evaluate(
    (node) => (node as HTMLElement).style.width,
  )).toBe("50%");
  await page.keyboard.up("z");

  await expect(body).toHaveAttribute("data-run-phase", "first_eye", {timeout: 12_000});
  await expect(page.locator("#pattern-name")).toHaveText("眼睛取样");
  await expect(page.locator("#pattern-name-en")).toHaveText("EYE ACQUISITION");
  await expect(body).toHaveAttribute("data-segment-start-tick", "960");
  await expect
    .poll(async () => Number(await body.getAttribute("data-live-colliders")), {
      message: "first_eye should expose entity-owned live colliders",
      timeout: 5_000,
    })
    .toBeGreaterThan(0);

  await expect(body).toHaveAttribute("data-source-drained", "true", {timeout: 18_000});
  await expect(body).toHaveAttribute("data-run-phase", "first_eye");
  await expect(body).toHaveAttribute("data-live-colliders", "0");
  await expect(body).toHaveAttribute("data-handoff-ready", "false");
  await expect(body).toHaveAttribute("data-source-live-entities", "0");
  await expect(body).toHaveAttribute("data-gaze-state", "idle");
  await expect(body).toHaveAttribute("data-gaze-clamp-committed", "false");
  await expect(body).toHaveAttribute("data-gaze-clamp-released", "false");
  await expect(body).toHaveAttribute("data-flower-recovery-complete", "false");
  await expect(page.locator("#pattern-name")).toHaveText("眼睛取样");
  await expect(page.locator("#pattern-name-en")).toHaveText("EYE ACQUISITION");

  expect(pageErrors, "canonical RUN should have no uncaught page errors").toEqual([]);
  expect(consoleErrors, "canonical RUN should have no error-level console messages").toEqual([]);
});
