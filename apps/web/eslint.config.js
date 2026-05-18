// apps/web — ESLint flat config (ESLint 9, Next.js 15).
//
// Composes the shared @school-kit/config/eslint/next preset with web-app-
// specific ignores. Anything not ignored here gets the full Next.js
// + React + typescript-eslint surface plus our strict overrides.

import { nextConfig } from "@school-kit/config/eslint/next";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // Sentry/instrumentation files are framework-generated stubs from
      // `npx @sentry/wizard@latest -i nextjs`. We include them in linting
      // when they hold real code; the auto-generated parts are minimal.
    ],
  },
  ...nextConfig,
];

export default config;
