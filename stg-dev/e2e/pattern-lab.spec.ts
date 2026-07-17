import {expect, test} from "@playwright/test";
import {
  enterSimulation,
  openApp,
  PATTERN_COUNT,
  readClock,
  readPatternClock,
  waitForClockAfter,
} from "./helpers/stg";

test.describe("V4 pattern lab", () => {
  test.beforeEach(async ({page}) => {
    await openApp(page, "pattern-lab");
  });

  test("enters the simulation and advances the fixed gameplay clock", async ({page}) => {
    const before = await readClock(page);
    await enterSimulation(page);
    await waitForClockAfter(page, before);
    await expect(page.locator("#boot-overlay")).toHaveCount(0);
  });

  test("exposes all 48 authoritative patterns and switches deterministically", async ({page}) => {
    const select = page.locator("#pattern-select");
    const options = select.locator("option");

    await expect(select).toBeEnabled();
    await expect(options).toHaveCount(PATTERN_COUNT);
    await expect.poll(() => options.evaluateAll((nodes) => new Set(nodes.map((node) => node.textContent)).size))
      .toBe(PATTERN_COUNT);

    await select.selectOption("0");
    await expect(select).toHaveValue("0");
    await expect(page.locator("#pattern-sequence")).toHaveText(`01 / ${PATTERN_COUNT}`);
    const firstName = await page.locator("#pattern-name").textContent();

    await page.locator("#next-pattern").click();
    await expect(select).toHaveValue("1");
    await expect(page.locator("#pattern-sequence")).toHaveText(`02 / ${PATTERN_COUNT}`);
    await expect(page.locator("#pattern-name")).not.toHaveText(firstName ?? "");

    await select.selectOption(String(PATTERN_COUNT - 1));
    await expect(page.locator("#pattern-sequence")).toHaveText(`${PATTERN_COUNT} / ${PATTERN_COUNT}`);
    await page.locator("#next-pattern").click();
    await expect(select).toHaveValue("0");
    await expect(page.locator("#pattern-sequence")).toHaveText(`01 / ${PATTERN_COUNT}`);
  });

  test("pauses and resumes without leaking wall-clock time into gameplay", async ({page}) => {
    await enterSimulation(page);
    const runningAt = await waitForClockAfter(page, 0);

    await page.keyboard.press("Space");
    await expect(page.locator("body")).toHaveClass(/\bpaused\b/);
    const frozenAt = await readClock(page);
    expect(frozenAt).toBeGreaterThanOrEqual(runningAt);

    await page.waitForTimeout(350);
    expect(await readClock(page)).toBe(frozenAt);

    await page.keyboard.press("Space");
    await expect(page.locator("body")).not.toHaveClass(/\bpaused\b/);
    await waitForClockAfter(page, frozenAt);
  });

  test("applies EASY, NORMAL, and HARD while resetting only the pattern clock", async ({page}) => {
    await enterSimulation(page);
    await expect.poll(() => readPatternClock(page)).toBeGreaterThan(0.25);

    const difficulty = page.locator("#difficulty");
    const output = page.locator("#difficulty-output");

    // Freeze the authoritative clock before observing the reset. Otherwise the
    // DOM may still show the pre-reset frame, or advance past a small threshold
    // before Playwright samples it, even though resetPattern() ran correctly.
    await page.keyboard.press("Space");
    await expect(page.locator("body")).toHaveClass(/\bpaused\b/);
    const globalBefore = await readClock(page);

    await difficulty.fill("2");
    await expect(difficulty).toHaveValue("2");
    await expect(output).toHaveText("HARD");
    await expect(page.locator("#pattern-time")).toHaveText("00.000");
    expect(await readClock(page)).toBe(globalBefore);

    await page.keyboard.press("Space");
    await expect(page.locator("body")).not.toHaveClass(/\bpaused\b/);
    await waitForClockAfter(page, globalBefore);

    await difficulty.fill("0");
    await expect(output).toHaveText("EASY");
    await difficulty.fill("1");
    await expect(output).toHaveText("NORMAL");
  });
});
