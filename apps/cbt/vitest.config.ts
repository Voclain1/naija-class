import { defineConfig } from "vitest/config";

// apps/cbt — pure logic only (*.spec.ts, node environment), as in apps/web
// and apps/portal. The local store runs on fake-indexeddb. Rendered behaviour
// is covered by Playwright (e2e/tests/cbt-delivery.spec.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
