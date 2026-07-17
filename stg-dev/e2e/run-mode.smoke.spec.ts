import {expect, test} from "@playwright/test";
import {enterSimulation, openApp, readClock, waitForClockAfter} from "./helpers/stg";

test("RUN DIRECTOR boots the production-facing simulation", async ({page}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await openApp(page);

  await expect(page.locator(".build-tag")).toHaveText("RUN");
  await expect(page.locator("#pattern-select")).toBeDisabled();
  await expect(page.getByText("48 PATTERNS", {exact: true})).toBeVisible();

  const before = await readClock(page);
  await enterSimulation(page);
  await waitForClockAfter(page, before);
  expect(pageErrors).toEqual([]);
});
