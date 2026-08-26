import { defineConfig } from "vitest/config";

// apps/web — Vitest config.
//
// Added 2026-08-25, during the carry-over incident. Until then apps/web's
// `test` script was `echo 'test placeholder'`, which meant a web-side unit
// test could be written but would never execute — in CI or locally. The
// incident's root cause was a pure rule in a client component (which
// candidate group arrives pre-ticked), and shipping a fix for it with no
// executable guard was not acceptable, so the runner exists now.
//
// environment: "node" and *.spec.ts only, deliberately. This is for PURE
// logic extracted out of components — selection rules, formatters, guards.
// COMPONENT/DOM TESTS ARE NOT SET UP: that needs jsdom plus a React Testing
// Library setup and is a larger decision than this incident should make on
// its own. Playwright already covers rendered behaviour end to end.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["node_modules/**", ".next/**", "dist/**"],
  },
});
