import { fileURLToPath } from "node:url";

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
  // The "@/" alias apps/web uses everywhere. Vitest does not read tsconfig
  // paths, so a pure module importing "@/lib/..." fails to resolve here even
  // though tsc and Next both accept it. Added 2026-09-09, when the dashboard
  // action resolver became the first spec-covered module to import through
  // the alias rather than a relative path.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["node_modules/**", ".next/**", "dist/**"],
  },
});
