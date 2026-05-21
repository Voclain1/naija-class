import { defineConfig, devices } from "@playwright/test";

// Phase 0 smoke. Single test, single worker, single browser — see
// docs/modules/phase-0.md acceptance criterion #8 and CLAUDE.md → Tests.
// Richer coverage (cross-browser, fixtures, storageState, parallelism) is
// deferred until we have 5+ tests; trying to design for it now would be
// premature abstraction.
export default defineConfig({
  testDir: "./tests",
  // Long-running by design: ~9 distinct routes compiled on-demand by Next.js
  // dev mode add up to a lot of cold-compile wall-clock per run. Production
  // builds compress this dramatically, but using dev mode in CI keeps the
  // setup symmetric with local. 180s is comfortable headroom over the
  // observed 60–90s end-to-end.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Spawn both servers when they're not already running. Locally this lets
  // the dev defaulting `pnpm dev` setup keep its servers; CI gets fresh
  // boots. Healthcheck URL is the unauthenticated GET /api/v1/health
  // endpoint (apps/api/src/health/health.controller.ts) — Playwright polls
  // it until a 2xx, then runs the test.
  webServer: [
    {
      command: "pnpm --filter @school-kit/api dev",
      url: "http://localhost:4000/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      cwd: "..",
    },
    {
      command: "pnpm --filter @school-kit/web dev",
      url: "http://localhost:3001",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      cwd: "..",
    },
  ],
});
