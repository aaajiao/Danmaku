import {expect, test} from "@playwright/test";
import {openApp, PATTERN_COUNT} from "./helpers/stg";

test("startup presents the V4 run contract before player input", async ({page}) => {
  await openApp(page);

  await expect(page.locator("#boot-overlay")).toBeVisible();
  await expect(page.getByRole("heading", {name: /先读取/})).toBeVisible();
  await expect(page.getByRole("button", {name: /进入模拟/})).toBeEnabled();
  await expect(page.locator("#header-clock")).toHaveText("000.000");
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#pattern-select option")).toHaveCount(PATTERN_COUNT);
  await expect(page.locator("#pattern-select")).toBeDisabled();
});
