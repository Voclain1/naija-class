// School Kit — shared ESLint config for Next.js apps (flat, ESLint 9).
//
// Composes the base config with Next's `core-web-vitals` + `typescript`
// presets (which themselves wire eslint-plugin-react, react-hooks, jsx-a11y,
// and @next/eslint-plugin-next) plus our project-specific overrides.
//
// Why FlatCompat: eslint-config-next v15.5 still ships legacy (eslintrc)
// configs — `index.js`, `core-web-vitals.js`, `typescript.js` — and no
// `flat/` export yet. FlatCompat from @eslint/eslintrc is the Next.js-team-
// documented migration bridge until eslint-config-next ships native flat.
// When that ships, this file collapses to a plain `extends` and we can drop
// @eslint/eslintrc from packages/config dependencies.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig } from "./base.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

export const nextConfig = [
  ...baseConfig,

  // eslint-config-next bundles React/JSX-A11y/Next rules. Pulling both
  // presets matches the default `create-next-app` lint surface.
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Project overrides applied AFTER the Next.js presets. Order matters:
  // `next/typescript` re-enables @typescript-eslint/no-unused-vars (which
  // we disable in baseConfig because unused-imports/no-unused-vars owns
  // that surface); we re-disable it here. Same for hook rules: bump
  // exhaustive-deps from warn (default) to error — missing-deps bugs in
  // useEffect/useMemo/useCallback are a real class of failure we want CI
  // to block, not just flag.
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },

  // Test files: console.log is fine, and `any` is a pragmatic escape
  // hatch in fixtures. Keeps the strict rules everywhere else.
  {
    files: ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}", "**/__tests__/**"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
