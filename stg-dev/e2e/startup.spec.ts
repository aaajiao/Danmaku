import {expect, test} from "@playwright/test";
import {openApp, PATTERN_COUNT} from "./helpers/stg";

test("startup presents the V4 run contract before player input", async ({page}) => {
  await openApp(page);

  await expect(page.locator("#boot-overlay")).toBeVisible();
  await expect(page.locator("#surface-name")).toHaveText("STG RUN");
  await expect(page.locator("#boot-action-label")).toHaveText("从没有留痕的条件开始");
  await expect(page.locator("#boot-button")).toHaveAttribute("title", "BEGIN WITHOUT RETAINED MATTER");
  await expect(page.locator("#boot-heading")).toBeHidden();
  await expect(page.locator("#boot-description")).toBeHidden();
  await expect(page.locator("#boot-meta")).toBeHidden();
  await expect(page.locator("#boot-key")).toBeHidden();
  await expect(page.locator(".lab-panel")).toBeHidden();
  await expect(page.locator("#header-clock")).toHaveText("000.000");
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#pattern-select option")).toHaveCount(PATTERN_COUNT);
  await expect(page.locator("#pattern-select")).toBeDisabled();
});

test("an invalid explicit RUN seed fails closed instead of selecting entropy", async ({page}) => {
  const pageError = page.waitForEvent("pageerror");
  const response = await page.goto("/?seed=not-a-uint32", {waitUntil: "domcontentloaded"});

  expect(response?.ok()).toBe(true);
  expect((await pageError).message).toBe("explicit encounter seed must be a decimal uint32");
  await expect(page.locator("body")).not.toHaveAttribute("data-authority", /.+/u);
  await expect(page.locator("body")).toHaveAttribute("data-startup-failure", "invalid-seed");
  await expect(page.locator("#boot-button")).toBeDisabled();
  await expect(page.locator("#boot-action-label")).toHaveText("这一路在这里中断");
  await expect(page.locator("#boot-button")).toHaveAttribute("title", "THIS ROUTE ENDED HERE");
  await expect(page.locator("#pattern-select option")).toHaveCount(0);
  await expect(page.locator("#header-clock")).toHaveText("000.000");
});
