// apps/mobile — ESLint flat config (ESLint 9, Expo SDK 52 / React Native).
//
// Composes the shared @school-kit/config/eslint/expo preset with mobile-app-
// specific ignores.
//
// Until 2026-08-15 this file did not exist and package.json's lint script was
// `echo 'lint placeholder'`. Because CI runs `pnpm lint` through Turbo across
// every workspace, mobile reported GREEN on every PR while checking nothing.
// That is worse than having no gate: a red gate gets fixed, a falsely green
// one gets trusted. See docs/modules/phase-6.md slice 1.

import { expoConfig } from "@school-kit/config/eslint/expo";

const config = [
  {
    ignores: [
      // Expo's generated router types + build scratch. `.expo/types` is
      // regenerated on every `expo start`; linting it fails on code we
      // don't own and can't fix.
      ".expo/**",
      "expo-env.d.ts",
      "node_modules/**",
      "dist/**",
      // Generated app assets — binary, and their provenance is the
      // scripts/generate-assets.mjs source, which IS linted.
      "assets/**",
    ],
  },
  ...expoConfig,
];

export default config;
