import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  /*
    The suite runs against `next dev`, which compiles routes lazily on first
    request. Unbounded workers overwhelm it and produce failures unrelated to
    the product, so parallelism is bounded. The dev server is required rather
    than a production build because the /dev review routes deliberately 404 in
    production.
  */
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Sandboxed environments can point at a preinstalled browser instead
        // of downloading one (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium).
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
