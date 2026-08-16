import { defineConfig } from "vitest/config";

// apps/mobile — Vitest config.
//
// environment: "node" is deliberate and currently sufficient. The specs in
// __tests__/ assert on build configuration and generated assets, which are
// plain files on disk — no React Native runtime is involved.
//
// COMPONENT TESTS ARE NOT SET UP YET, and that is a deferred decision rather
// than an oversight. Rendering RN components needs either jest-expo (which
// would fragment the toolchain — every other workspace here runs Vitest) or
// Vitest plus a react-native transform (Metro-flavoured Flow syntax in
// react-native's own source does not go through esbuild unaided). Neither is
// worth choosing before there is a component worth testing; slice 2 is the
// first slice that has one, and it owns the decision. See
// docs/modules/phase-6.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.ts", "**/*.test.ts"],
    exclude: ["node_modules/**", ".expo/**", "dist/**"],
  },
});
