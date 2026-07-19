import {expect, test} from "@playwright/test";
import {enterSimulation, openApp, readClock, RUN_AUTHORITY, waitForClockAfter} from "./helpers/stg";

/*
 * Smoke is boot and critical availability only: the production artifact loads,
 * the V4 atlases are actually served, the app is installable, gameplay time
 * starts, and the whole thing still boots from the service worker while
 * offline. Complete authored journeys belong to the chromium project.
 */

test("the production RUN boots, serves its V4 atlases, and starts gameplay time", async ({page}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText ?? "unknown failure"}`);
  });

  const coreAtlasResponsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === "GET"
      && /\/assets\/core-grammar-v3-[^/]+\.png$/u.test(pathname);
  });

  await openApp(page);

  const coreAtlasResponse = await coreAtlasResponsePromise;
  expect(coreAtlasResponse.status(), `GET ${coreAtlasResponse.url()} should return the V4 core atlas`).toBe(200);
  expect(coreAtlasResponse.headers()["content-type"]).toMatch(/^image\/png/i);

  await expect(page.locator("#surface-name")).toHaveText("STG RUN");
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-run-phase", /^[A-Z_]+$/u);

  const before = await readClock(page);
  await enterSimulation(page);
  await waitForClockAfter(page, before);

  expect(pageErrors, "production RUN should have no uncaught page errors").toEqual([]);
  expect(consoleErrors, "production RUN should have no error-level console messages").toEqual([]);
  expect(failedRequests, "production RUN should have no failed network requests").toEqual([]);
});

test("the production RUN publishes a web manifest and boots again while offline", async ({page, context}) => {
  await openApp(page);

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  const manifestHref = await manifestLink.getAttribute("href");
  expect(manifestHref, "production preview should publish a web manifest URL").toBeTruthy();
  const manifestURL = new URL(manifestHref!, page.url());
  const manifestResponse = await page.context().request.get(manifestURL.href);
  expect(manifestResponse.status(), `GET ${manifestURL.href} should return the production web manifest`).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toMatch(/(?:application\/manifest\+json|application\/json)/i);
  const webManifest = await manifestResponse.json() as {name?: string; categories?: string[]};
  expect(webManifest.name).toBe("1bit STG Run");
  expect(webManifest.categories).toEqual(["games", "entertainment"]);

  const controlledByInstalledWorker = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  if (!controlledByInstalledWorker) await page.reload({waitUntil: "domcontentloaded"});
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.locator("body")).toHaveAttribute("data-authority", RUN_AUTHORITY);
  await expect(page.locator("body")).toHaveAttribute("data-raw-run-seed", /^\d+$/u);
  await expect(page.locator("#boot-button")).toBeEnabled();
  await context.setOffline(false);
});
