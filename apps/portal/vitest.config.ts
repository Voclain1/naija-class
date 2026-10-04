import { defineConfig } from "vitest/config";

// apps/portal — Vitest config, added 2026-10-05 with the portal's first pure
// module that needed a spec (src/lib/client-ip-signature.ts). Same shape and
// limits as apps/web's: node environment, *.spec.ts only, pure logic. Rendered
// behaviour is covered by Playwright.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
