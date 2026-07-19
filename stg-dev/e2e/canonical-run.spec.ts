import {expect, test, type Page} from "@playwright/test";
import {
  advanceControlledRunToPhase,
  advanceControlledRunToTick,
  advanceOneTick,
  beginControlledRun,
  openControlled,
  pressMeaningfulInput,
  readAuthorityTick,
  RUN_AUTHORITY,
  stepRaf,
} from "./helpers/stg";

/*
 * The authored opening, driven through the controlled frame source so the
 * journey is tick-exact rather than wall-clock flaky. Every wait is on a fact
 * the RunConductor published; nothing here reads back a rendered result to
 * decide what to do next.
 *
 * Authored guards under test (narrative-state-machine-v4.json):
 *   AWAKENING            exit: run.elapsedMs >= 6000 && player.meaningfulInputCount >= 2
 *   FIRST_EYE            to FIRST_CLAMP_RECOVERY: gaze.pitchDeg > 45 && gaze.directness >= 0.55
 *   FIRST_CLAMP_RECOVERY exit: gaze.clampReleased && flower.recoveryComplete
 */

const FIXED_SEED = "305419896";
const AWAKENING_MINIMUM_TICKS = 6 * 120;

function watchForErrors(page: Page): {pageErrors: string[]; consoleErrors: string[]} {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return {pageErrors, consoleErrors};
}

test("the authored opening runs from the quiet awakening into room sampling", async ({page}) => {
  test.slow();
  const {pageErrors, consoleErrors} = watchForErrors(page);
  await openControlled(page, `/?seed=${FIXED_SEED}`);
  const body = page.locator("body");
  const canvas = page.locator("#game-canvas");

  await beginControlledRun(page);
  await expect(body).toHaveAttribute("data-authority", RUN_AUTHORITY);
  // The run rehydrates the previous run's material before the player can act.
  // With a fresh archive there is nothing to rehydrate and no route to replay,
  // so those states pass through into the quiet awakening on their own.
  await advanceControlledRunToTick(page, AWAKENING_MINIMUM_TICKS);

  // Half of the authored guard: the minimum duration alone does not hand off.
  // The player has to have actually done something twice.
  await expect(body).toHaveAttribute("data-run-phase", "AWAKENING");

  // A signal press is deliberately NOT a meaningful input: the authored guard
  // counts movement/focus/gaze, and pressing signal alone must not hand off.
  await page.keyboard.down("z");
  await stepRaf(page, 0);
  await advanceOneTick(page);
  await page.keyboard.up("z");
  await stepRaf(page, 0);
  await advanceOneTick(page);
  await expect(body).toHaveAttribute("data-run-phase", "AWAKENING");

  // First meaningful rising edge — still short of the authored count.
  await pressMeaningfulInput(page, "d");
  await expect(body).toHaveAttribute("data-run-phase", "AWAKENING");

  // The second edge closes the guard.
  await pressMeaningfulInput(page, "Shift");
  await expect(body).toHaveAttribute("data-run-phase", "FIRST_EYE");

  // The Eye is what the authority puts in the sky, and it arrives as authored
  // content, not as a presentation flourish.
  await expect(canvas).toHaveAttribute("data-presented-pattern-id", "common.eye_acquisition");
  const eyeRoom = await canvas.getAttribute("data-presented-room");
  expect(eyeRoom, "the First Eye is presented inside an authored room").toBeTruthy();

  // Reading the Eye clamps the gaze. The device carries only a held intent, so
  // the adapter resolves it to the extremum of the authored sample domain.
  await page.keyboard.down("g");
  await stepRaf(page, 0);
  await advanceControlledRunToPhase(page, "FIRST_CLAMP_RECOVERY", 20);
  await page.keyboard.up("g");
  await stepRaf(page, 0);

  // The authored lesson is bodily: the flower recovers later than the Eye
  // releases it, so leaving this state is not immediate.
  const clampTick120 = await readAuthorityTick(page);
  const samplingTick120 = await advanceControlledRunToPhase(page, "ROOM_SAMPLING", 60);
  expect(
    samplingTick120,
    "flower recovery outlasts the clamp release, so room sampling cannot start on the same tick",
  ).toBeGreaterThan(clampTick120);

  // Entering room sampling arms the room ledger; the composer's own selection
  // reaches the world a moment later, so the Eye's pattern is still presented on
  // the handoff tick itself.
  await expect(canvas).toHaveAttribute("data-presented-pattern-id", "common.eye_acquisition");
  await advanceControlledRunToTick(page, samplingTick120 + 120);

  // Once sampling is under way the world presents a composer-selected room
  // pattern. The room slug is deliberately NOT reconstructed from the room id
  // here: the manifests disagree by design and only the asset bindings may
  // resolve that mapping, so this asserts the authored shape and leaves the
  // exact selection to the determinism test below.
  await expect(canvas).toHaveAttribute("data-presented-room", /^[A-Z_]+$/u);
  await expect(canvas).toHaveAttribute("data-presented-pattern-id", /^room\.[a-z0-9_]+\.[a-z0-9_]+$/u);

  // Gameplay time never resumed from a refused tick.
  await expect(body).not.toHaveAttribute("data-run-failure", /.+/u);
  expect(pageErrors, "the authored opening should have no uncaught page errors").toEqual([]);
  expect(consoleErrors, "the authored opening should have no error-level console messages").toEqual([]);
});

/*
 * Retargeted from the deleted Pattern Lab spec. The value it carried was clock
 * determinism, which was never lab-specific: pause freezes gameplay time and
 * DISCARDS the wall time observed while paused, so resuming produces no
 * catch-up burst.
 */
test("pause freezes gameplay time and resumes without a catch-up burst", async ({page}) => {
  await openControlled(page, `/?seed=${FIXED_SEED}`);
  const body = page.locator("body");

  await beginControlledRun(page);
  await advanceControlledRunToTick(page, 120);

  await page.keyboard.press("Space");
  await stepRaf(page, 0);
  await expect(body).toHaveClass(/\bpaused\b/);
  const frozenTick120 = await readAuthorityTick(page);

  // Wall time keeps passing with the run paused.
  await stepRaf(page, 1_000);
  expect(await readAuthorityTick(page)).toBe(frozenTick120);
  await stepRaf(page, 1_000);
  expect(await readAuthorityTick(page)).toBe(frozenTick120);

  // Resuming discards the paused interval instead of replaying it.
  await page.keyboard.press("Space");
  await stepRaf(page, 1_000);
  await expect(body).not.toHaveClass(/\bpaused\b/);
  expect(
    await readAuthorityTick(page),
    "the resume frame's own interval was observed while paused and is discarded",
  ).toBe(frozenTick120);

  // Gameplay time resumes from where it froze — forward, and without replaying
  // the paused wall time as a burst.
  await stepRaf(page, 100);
  const resumedTick120 = await readAuthorityTick(page);
  expect(resumedTick120).toBeGreaterThan(frozenTick120);
  expect(resumedTick120 - frozenTick120).toBeLessThanOrEqual(12);
});

/*
 * Also retargeted from the Pattern Lab spec, which proved determinism by
 * switching authored patterns by hand. The product claim is stronger than that:
 * one seed and one tick-exact input sequence produce one identical run.
 */
test("one seed and one tick-exact input sequence produce one identical opening", async ({page}) => {
  test.slow();
  const observed: Array<Record<string, string | null>> = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await openControlled(page, `/?seed=${FIXED_SEED}`);
    await beginControlledRun(page);
    await advanceControlledRunToTick(page, AWAKENING_MINIMUM_TICKS);
    await pressMeaningfulInput(page, "d");
    await pressMeaningfulInput(page, "Shift");
    await page.keyboard.down("g");
    await stepRaf(page, 0);
    await advanceControlledRunToPhase(page, "FIRST_CLAMP_RECOVERY", 20);
    await page.keyboard.up("g");
    await stepRaf(page, 0);
    const samplingTick120 = await advanceControlledRunToPhase(page, "ROOM_SAMPLING", 60);
    await advanceControlledRunToTick(page, samplingTick120 + 120);

    observed.push(await page.evaluate(() => ({
      tick120: document.body.dataset.authorityTick ?? null,
      phase: document.body.dataset.runPhase ?? null,
      seed: document.body.dataset.rawRunSeed ?? null,
      room: document.getElementById("game-canvas")?.getAttribute("data-presented-room") ?? null,
      patternId: document.getElementById("game-canvas")?.getAttribute("data-presented-pattern-id") ?? null,
      clock: document.getElementById("header-clock")?.textContent ?? null,
    })));
  }

  expect(observed[1]).toEqual(observed[0]);
});
