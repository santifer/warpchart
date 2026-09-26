import { defineConfig, devices } from "@playwright/test";

// Post-deploy smoke in the REAL client: WebKit is the engine of every iPhone,
// and the avatar redirect that broke on iOS (2026-08-12) loaded fine in the
// Chromium we used to check with. Both themes, because a token that works in
// one can be inverted in the other (the ring-panel bug was).
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.SMOKE_BASE ?? "https://warpchart.dev",
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [
    { name: "iphone-dark", use: { ...devices["iPhone 14 Pro"], colorScheme: "dark" } },
    { name: "iphone-light", use: { ...devices["iPhone 14 Pro"], colorScheme: "light" } },
    { name: "desktop-dark", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
  ],
});
