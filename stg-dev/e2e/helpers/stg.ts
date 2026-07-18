import {expect, type Page} from "@playwright/test";

export const PATTERN_COUNT = 48;

export type AppMode = "run" | "pattern-lab";

export async function openApp(page: Page, mode: AppMode = "run"): Promise<void> {
  const path = mode === "pattern-lab" ? "/?mode=pattern-lab" : "/";
  const response = await page.goto(path, {waitUntil: "domcontentloaded"});

  expect(response, `GET ${path} should return a document response`).not.toBeNull();
  expect(response?.ok(), `GET ${path} should succeed`).toBe(true);
  await expect(page).toHaveTitle(/1bit \/ STG/i);

  // The select is populated by the V4 manifest after the application module is
  // ready. Waiting on this contract also prevents clicking the static boot HTML
  // before its handlers have been attached.
  await expect(page.locator("#pattern-select option")).toHaveCount(PATTERN_COUNT);
}

export async function enterSimulation(page: Page): Promise<void> {
  const overlay = page.locator("#boot-overlay");
  await expect(overlay).toBeVisible();
  await page.getByRole("button", {name: /进入模拟/}).click();
  await expect(overlay).toHaveCount(0, {timeout: 10_000});
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

export async function readPatternClock(page: Page): Promise<number> {
  const raw = (await page.locator("#pattern-time").textContent())?.trim() ?? "";
  const value = Number.parseFloat(raw);
  expect(Number.isFinite(value), `pattern clock should be numeric, received: ${raw}`).toBe(true);
  return value;
}
