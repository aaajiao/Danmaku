import {expect, test} from "@playwright/test";
import {
  advanceControlledRunToPhase,
  advanceControlledRunToTick,
  advanceOneTick,
  beginControlledRun,
  openControlled,
  pressMeaningfulInput,
  readAuthorityTick,
  setAccessibilitySwitch,
  stepRaf,
} from "./helpers/stg";

/*
 * The RAF -> AuthorityClock bridge, observed through the published surface.
 *
 * The entry point owns no gameplay rule; it owns the wall-clock bridge. These
 * are the bridge semantics observable from outside the page:
 *
 *   - boot-interval discard: the interval ending at the first started frame has
 *     no prior gameplay sample and is discarded exactly once per run start;
 *   - wall-delta integrity: the WHOLE delta reaches AuthorityClock, which caps
 *     one advance at 1024 boundaries and RETAINS the rest as backlog;
 *   - accessibility is presentation-only: it must leave the gameplay trace
 *     bit-identical.
 *
 * Pause (freeze + discard of the wall time observed while paused) is proven in
 * canonical-run.spec.ts, next to the journey it protects.
 *
 * NOT covered here, deliberately and not silently: held-input reconciliation at
 * the wall head, and the dropping of Override edges sampled while the authored
 * input surface is absent. Both are real bridge semantics, but the published
 * observability surface exposes no Override or held-input fact, and this layer
 * will not assert a claim it cannot actually see.
 */

const FIXED_SEED = "305419896";
const AWAKENING_MINIMUM_TICKS = 6 * 120;

test("the boot interval is discarded once and no wall time is invented or lost", async ({page}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openControlled(page, `/?seed=${FIXED_SEED}`);
  const body = page.locator("body");

  // The frame that starts the run carries a wall interval measured from page
  // load. It is discarded, so the run begins at tick 0 rather than jumping
  // straight to however long the player looked at the boot card.
  await beginControlledRun(page);
  await expect(body).toHaveAttribute("data-run-phase", "BOOT_REHYDRATE");

  // A frame that observed no wall time invents no gameplay time.
  const atRest = await readAuthorityTick(page);
  await stepRaf(page, 0);
  expect(await readAuthorityTick(page)).toBe(atRest);

  /*
   * One second of wall time is worth 120 boundaries, whether it arrives as one
   * frame or as ten.
   *
   * The tolerance of one boundary is the HARNESS's, not the clock's: a frame
   * timestamp is a double, so `now + 100` ten times is not bit-identical to
   * `now + 1000`, and the clock deliberately refuses to round up wall time it
   * was never given. What must hold is that the sub-tick residue is CARRIED
   * across frames instead of being dropped at each one — ten frames losing a
   * tick each would land near 110, not near 120. Exact gameplay identity is
   * asserted where it belongs, against a fixed seed, in canonical-run.spec.ts.
   */
  const beforeWholeSecond = await readAuthorityTick(page);
  await stepRaf(page, 1_000);
  const wholeSecondTicks = await readAuthorityTick(page) - beforeWholeSecond;

  const beforeChoppedSecond = await readAuthorityTick(page);
  for (let frame = 0; frame < 10; frame += 1) await stepRaf(page, 100);
  const choppedSecondTicks = await readAuthorityTick(page) - beforeChoppedSecond;

  for (const ticks of [wholeSecondTicks, choppedSecondTicks]) {
    expect(ticks).toBeGreaterThanOrEqual(119);
    expect(ticks).toBeLessThanOrEqual(120);
  }

  expect(pageErrors, "the controlled bridge should have no uncaught page errors").toEqual([]);
});

test("a long frame is capped at 1024 boundaries and its backlog is retained, not dropped", async ({page}) => {
  await openControlled(page, `/?seed=${FIXED_SEED}`);
  await beginControlledRun(page);

  // Ten seconds of wall time is 1200 boundaries. One advance may only run 1024
  // of them, so this frame is capped well short of the wall head.
  await stepRaf(page, 10_000);
  const cappedTick120 = await readAuthorityTick(page);
  expect(cappedTick120).toBeGreaterThanOrEqual(1023);
  expect(cappedTick120).toBeLessThanOrEqual(1024);

  // The remaining ~176 boundaries were RETAINED, not dropped: a zero-length
  // frame drains them, which is only possible if the whole delta reached the
  // clock in the first place.
  await stepRaf(page, 0);
  const drainedTick120 = await readAuthorityTick(page);
  expect(drainedTick120).toBeGreaterThanOrEqual(1199);
  expect(drainedTick120).toBeLessThanOrEqual(1200);

  // And the drain is finite: nothing is invented once the backlog is empty.
  await stepRaf(page, 0);
  expect(await readAuthorityTick(page)).toBe(drainedTick120);
});

test("reduced motion and flashing-off leave the gameplay trace identical", async ({page}) => {
  test.slow();
  const profiles = [
    {reducedMotion: false, flashOff: false},
    {reducedMotion: true, flashOff: false},
    {reducedMotion: false, flashOff: true},
  ] as const;
  const traces: Array<Record<string, string | null>> = [];

  for (const profile of profiles) {
    await openControlled(page, `/?seed=${FIXED_SEED}`);
    const body = page.locator("body");

    // Accessibility is presentation-only, so it is set before the run and is
    // never handed to the conductor.
    await setAccessibilitySwitch(page, "reduced-motion", profile.reducedMotion);
    await setAccessibilitySwitch(page, "flash-off", profile.flashOff);
    await expect(body).toHaveAttribute("data-reduced-motion", String(profile.reducedMotion));
    await expect(body).toHaveAttribute("data-flash-off", String(profile.flashOff));

    await beginControlledRun(page);
    await advanceControlledRunToTick(page, AWAKENING_MINIMUM_TICKS);
    await pressMeaningfulInput(page, "d");
    await pressMeaningfulInput(page, "Shift");
    await expect(body).toHaveAttribute("data-run-phase", "FIRST_EYE");
    await page.keyboard.down("g");
    await stepRaf(page, 0);
    await advanceControlledRunToPhase(page, "FIRST_CLAMP_RECOVERY", 20);
    await page.keyboard.up("g");
    await stepRaf(page, 0);
    await advanceControlledRunToTick(page, await readAuthorityTick(page) + 240);

    traces.push(await page.evaluate(() => ({
      tick120: document.body.dataset.authorityTick ?? null,
      phase: document.body.dataset.runPhase ?? null,
      clock: document.getElementById("header-clock")?.textContent ?? null,
      room: document.getElementById("game-canvas")?.getAttribute("data-presented-room") ?? null,
      patternId: document.getElementById("game-canvas")?.getAttribute("data-presented-pattern-id") ?? null,
    })));
  }

  expect(traces[1], "reduced motion must not change the gameplay trace").toEqual(traces[0]);
  expect(traces[2], "flashing-off must not change the gameplay trace").toEqual(traces[0]);
});

test("one touch contact reaches the authority as one device-neutral fact", async ({browser, baseURL}) => {
  expect(baseURL).toBeTruthy();
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: {width: 900, height: 900},
  });
  try {
    const page = await context.newPage();
    await openControlled(page, `/?seed=${FIXED_SEED}`);
    await beginControlledRun(page);

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

    // A pointer drag is canonical movement — the same device-neutral fact WASD
    // produces, arriving from another device.
    await client.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [touchPoint]});
    await stepRaf(page, 0);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{...touchPoint, x: touchPoint.x - 40, y: touchPoint.y + 40}],
    });
    await stepRaf(page, 0);
    await advanceOneTick(page);
    await client.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
    await stepRaf(page, 0);

    // One contact is one fact, not a shortcut past the authored minimum
    // duration: the run is still in its quiet opening.
    await advanceControlledRunToTick(page, 60);
    await expect(page.locator("body")).toHaveAttribute("data-run-phase", "AWAKENING");
  } finally {
    await context.close();
  }
});
