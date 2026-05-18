// School Kit — shared ESLint base config (flat, ESLint 9).
//
// What this file provides:
//   - TypeScript parsing + typescript-eslint's recommended rules
//   - Unused-import + unused-variable enforcement via eslint-plugin-unused-imports
//     (we don't use @typescript-eslint/no-unused-vars because the dedicated
//     plugin gives auto-fix for unused imports specifically)
//   - no-console as a warning, with console.info/warn/error allowed
//     (observability code uses console.info deliberately)
//   - any-related rules: explicit `any` in signatures is an error;
//     inferred `any` (no-explicit-any) is a warning since TypeScript already
//     catches most real cases via noImplicitAny
//
// What it does NOT provide:
//   - React / Next.js specifics — those live in ./next.js
//   - Node-specific globals — Nest/CLI configs would add those in ./nest.js
//     when that exists
//
// Usage from a consumer's eslint.config.js:
//   import { baseConfig } from "@school-kit/config/eslint/base";
//   export default [...baseConfig, /* consumer overrides */];

import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";

export const baseConfig = [
  ...tseslint.configs.recommended,
  {
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      // The unused-imports plugin owns the unused-* surface entirely;
      // disable the typescript-eslint equivalent so the two don't fight.
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          // Standard "underscore-prefix means intentional" escape hatch.
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Explicit `any` in signatures = error. Inferred uses = warning,
      // since TS' noImplicitAny already covers the genuinely-unsafe cases.
      "@typescript-eslint/no-explicit-any": "warn",

      // console.log only — info/warn/error are used for observability logs.
      "no-console": ["warn", { allow: ["info", "warn", "error"] }],
    },
  },
];
