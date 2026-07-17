import {expect, test} from "@playwright/test";
import {openApp} from "./helpers/stg";

interface WebAppManifest {
  id?: string;
  name?: string;
  short_name?: string;
  display?: string;
  start_url?: string;
  icons?: Array<{src?: string; sizes?: string; type?: string; purpose?: string}>;
}

test("publishes an installable manifest and reachable any/maskable icons", async ({page}) => {
  await openApp(page);

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  const href = await manifestLink.getAttribute("href");
  expect(href, "manifest link should have an href").toBeTruthy();

  const manifestURL = new URL(href!, page.url());
  const response = await page.context().request.get(manifestURL.href);
  expect(response.ok(), `GET ${manifestURL.href} should succeed`).toBe(true);
  expect(response.headers()["content-type"]).toMatch(/(?:application\/manifest\+json|application\/json)/i);

  const manifest = await response.json() as WebAppManifest;
  expect(manifest).toMatchObject({
    id: "/",
    display: "standalone",
  });
  expect(manifest.name?.trim()).toBeTruthy();
  expect(manifest.short_name?.trim()).toBeTruthy();
  expect(manifest.start_url).toBeTruthy();

  const icons = manifest.icons ?? [];
  expect(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")).toBe(true);
  expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")).toBe(true);
  expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);

  for (const icon of icons) {
    expect(icon.src, "every manifest icon should define a src").toBeTruthy();
    const iconURL = new URL(icon.src!, manifestURL);
    const iconResponse = await page.context().request.get(iconURL.href);
    expect(iconResponse.ok(), `GET ${iconURL.href} should succeed`).toBe(true);
    expect(iconResponse.headers()["content-type"]).toMatch(/^image\/png/i);
  }
});
