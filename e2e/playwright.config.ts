import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load the repo-root .env into THIS process (and, because Playwright re-imports
// this config in every worker, into each worker too). Slice 11 cp4 needs
// `DATABASE_URL` available before any test imports `@school-kit/db`: the
// teacher-invitation fixture (e2e/fixtures/db.ts) seeds an Invitation row
// directly through the tenant client because no API endpoint creates a
// `roleKey='teacher'` invitation yet (POST /users/invite is admin-only in
// Phase 0). `basePrisma` is constructed at module import, so the env must be
// present first; doing it here at config module-scope guarantees that ordering.
dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
});

// Phase 0 smoke seeded this harness; slice 11 cp4 grows it into a small
// fixture-backed suite (see e2e/fixtures/). We're now past the "5+ tests"
// threshold the original comment deferred richer coverage behind, so fixtures
// live in e2e/fixtures/ and tests stay API-first for setup, UI-only for
// assertions.
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
