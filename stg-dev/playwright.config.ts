import {fileURLToPath} from "node:url";
import {defineConfig, devices} from "@playwright/test";

const projectDir = fileURLToPath(new URL(".", import.meta.url));
const requestedPort = Number.parseInt(process.env.STG_E2E_PORT ?? "4173", 10);

if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535) {
  throw new Error(`STG_E2E_PORT must be a valid TCP port, received: ${process.env.STG_E2E_PORT}`);
}

const externalBaseURL = process.env.STG_E2E_BASE_URL?.replace(/\/+$/, "");
const baseURL = externalBaseURL ?? `http://127.0.0.1:${requestedPort}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/playwright",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Parallel headless Three.js contexts can exhaust SwiftShader and emit false
  // shader validation failures. A single worker keeps the visual runtime stable;
  // callers can still opt into more workers explicitly when hardware permits.
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  reporter: process.env.CI
    ? [["line"], ["html", {open: "never", outputFolder: "playwright-report"}]]
    : [["list"], ["html", {open: "never", outputFolder: "playwright-report"}]],
  use: {
    baseURL,
    actionTimeout: 7_500,
    navigationTimeout: 15_000,
    colorScheme: "dark",
    locale: "zh-CN",
    serviceWorkers: "allow",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: `bun run build && bun run preview -- --port ${requestedPort} --strictPort`,
        cwd: projectDir,
        url: baseURL,
        // A server already occupying the port could be Vite dev and would make
        // the PWA checks exercise dev-dist instead of the production artifact.
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "smoke",
      testMatch: "**/*.smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "chromium",
      testIgnore: "**/*.smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
