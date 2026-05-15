import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

// Vitest config for apps/api.
//
// Why SWC instead of the default esbuild transform: NestJS dependency
// injection reads constructor parameter types via reflect-metadata, which
// requires `emitDecoratorMetadata`. esbuild does not emit that metadata, so
// `this.authService` would be undefined at runtime when Nest tries to wire
// AuthController in the controller integration spec. SWC, configured below
// with `decoratorMetadata: true`, emits the metadata Nest needs.
//
// Tests live next to source as `*.spec.ts`, plus integration suites under
// `src/__tests__/`. Integration tests connect to the real Postgres in
// docker-compose — we deliberately do not mock the DB for tenancy work
// because the bug class we care about (RLS misconfiguration) only manifests
// against real Postgres.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: "es2022",
        keepClassNames: true,
      },
    }),
  ],
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
