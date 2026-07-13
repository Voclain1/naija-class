// apps/portal — ESLint flat config (ESLint 9, Next.js 15). See apps/web's
// eslint.config.js for the full note on the shared preset.

import { nextConfig } from "@school-kit/config/eslint/next";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  ...nextConfig,
];

export default config;
