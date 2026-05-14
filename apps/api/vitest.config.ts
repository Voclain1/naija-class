import { defineConfig } from "vitest/config";

// Vitest config for apps/api.
// Tests live next to source as `*.spec.ts`, plus integration suites under
// `src/__tests__/`. Integration tests connect to the real Postgres in
// docker-compose — we deliberately do not mock the DB for tenancy work because
// the bug class we care about (RLS misconfiguration) only manifests against
// real Postgres.
export default defineConfig({
  test: {
    globals: false,
    include: ["src/**/*.spec.ts", "src/**/__tests__/**/*.spec.ts"],
    environment: "node",
    // Long timeout: the RLS test runs migrations against the dev DB.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Tests open shared connections to the dev DB; serial execution keeps
    // setUp/tearDown deterministic.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
