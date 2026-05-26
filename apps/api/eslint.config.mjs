// apps/api — ESLint flat config (ESLint 9, NestJS 10).
//
// Extends the shared base config, which provides:
//   - typescript-eslint recommended
//   - unused-imports plugin
//   - no-explicit-any / no-console policies
//   - **no-restricted-imports banning basePrisma outside tenant-client.ts**
//     (the slice-6-cp1 invariant; allowlist lives in the base config)
//
// Project-specific ignores below — nothing else to override at app level.

import { baseConfig } from "@school-kit/config/eslint/base";

const config = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...baseConfig,
];

export default config;
