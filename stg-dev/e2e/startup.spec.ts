import {expect, test} from "@playwright/test";
import {openApp, RUN_AUTHORITY} from "./helpers/stg";

test("startup states the run's own conditions before any player input", async ({page}) => {
  await openApp(page, "/?seed=305419896");

  await expect(page.locator("#boot-overlay")).toBeVisible();
  await expect(page.locator("#surface-name")).toHaveText("STG RUN");
  await expect(page.locator("#game-canvas")).toBeVisible();

  // The seed is stated, not hidden: reproducing a run is a player-facing fact.
  await expect(page.locator("#boot-seed")).toHaveText("305419896");
  await expect(page.locator("body")).toHaveAttribute("data-raw-run-seed", "305419896");

  // A fresh archive means the boot action states beginning without retained
  // matter — never a judgment about the absent run.
  await expect(page.locator("#boot-action-label")).toHaveText("从没有留痕的条件开始");
  await expect(page.locator("#boot-button")).toHaveAttribute("title", "BEGIN WITHOUT RETAINED MATTER");
  await expect(page.locator("#boot-button")).toBeEnabled();

  // The PNG export has no authored sentence and no implementation, so the
  // control is absent rather than shown disabled.
  await expect(page.locator("#snapshot-action-export")).toBeHidden();

  await expect(page.locator("#header-clock")).toHaveText("000.000");
  await expect(page.locator("body")).toHaveAttribute("data-authority", RUN_AUTHORITY);
});

test("an invalid explicit RUN seed fails closed instead of selecting entropy", async ({page}) => {
  const pageError = page.waitForEvent("pageerror");
  const response = await page.goto("/?seed=not-a-uint32", {waitUntil: "domcontentloaded"});

  expect(response?.ok()).toBe(true);
  expect((await pageError).message).toBe("explicit raw Run seed must be a decimal uint32");

  const body = page.locator("body");
  await expect(body).toHaveAttribute("data-startup-failure", "invalid-seed");
  // No authority was ever constructed, so none is claimed and no gameplay time
  // exists to report.
  await expect(body).not.toHaveAttribute("data-authority", /.+/u);
  await expect(body).not.toHaveAttribute("data-authority-tick", /.+/u);
  await expect(body).not.toHaveAttribute("data-raw-run-seed", /.+/u);
  await expect(body).not.toHaveAttribute("data-run-phase", /.+/u);

  await expect(page.locator("#boot-button")).toBeDisabled();
  await expect(page.locator("#boot-action-label")).toHaveText("这一路在这里中断");
  await expect(page.locator("#boot-button")).toHaveAttribute("title", "THIS ROUTE ENDED HERE");
  await expect(page.locator("#header-clock")).toHaveText("000.000");
});
