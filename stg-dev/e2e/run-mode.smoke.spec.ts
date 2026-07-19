import {expect, test} from "@playwright/test";
import {enterSimulation, openApp, readClock, waitForClockAfter} from "./helpers/stg";

test("canonical RUN boots the production-facing simulation", async ({page, context}) => {
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

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  const manifestHref = await manifestLink.getAttribute("href");
  expect(manifestHref, "production preview should publish a web manifest URL").toBeTruthy();
  const manifestURL = new URL(manifestHref!, page.url());
  const manifestResponse = await page.context().request.get(manifestURL.href);
  expect(manifestResponse.status(), `GET ${manifestURL.href} should return the production web manifest`).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toMatch(/(?:application\/manifest\+json|application\/json)/i);
  const webManifest = await manifestResponse.json() as {
    name?: string;
    categories?: string[];
    shortcuts?: Array<{url?: string}>;
  };
  expect(webManifest.name).toBe("1bit STG Run");
  expect(webManifest.categories).toEqual(["games", "entertainment"]);
  expect(webManifest.shortcuts?.some((shortcut) => shortcut.url === "./?mode=pattern-lab")).toBe(true);

  await expect(page.locator("#surface-name")).toHaveText("STG RUN");
  await expect(page.locator(".lab-panel")).toBeHidden();
  await expect(page.locator("#pattern-select")).toBeDisabled();
  await expect(page.getByText("48 PATTERNS", {exact: true})).toBeHidden();
  await expect(page.locator("#boot-action-label")).toHaveText("从没有留痕的条件开始");
  await expect(page.locator("body")).toHaveAttribute("data-authority", "canonical-run-session-v4");
  await expect(page.locator("body")).toHaveAttribute("data-run-phase", "quiet_awakening");
  await expect(page.locator("body")).toHaveAttribute("data-live-colliders", "0");
  await expect(page.locator("body")).toHaveAttribute("data-meaningful-inputs", "0");
  await expect(page.locator(".controls-strip")).toBeHidden();
  await expect(page.locator("#signal-fallback")).toBeHidden();

  const before = await readClock(page);
  await enterSimulation(page);
  await waitForClockAfter(page, before);

  const controlledByInstalledWorker = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  if (!controlledByInstalledWorker) await page.reload({waitUntil: "domcontentloaded"});
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await context.setOffline(true);
  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.locator("body")).toHaveAttribute("data-authority", "canonical-run-session-v4");
  await expect(page.locator("#pattern-select option")).toHaveCount(48);
  await expect(page.locator("#boot-action-label")).toHaveText("从没有留痕的条件开始");
  await context.setOffline(false);

  expect(pageErrors, "production RUN should have no uncaught page errors").toEqual([]);
  expect(consoleErrors, "production RUN should have no error-level console messages").toEqual([]);
  expect(failedRequests, "production RUN should have no failed network requests").toEqual([]);
});
