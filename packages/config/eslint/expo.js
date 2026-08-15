// School Kit — shared ESLint config for Expo / React Native apps
// (flat, ESLint 9).
//
// Composes the base config with React + React Hooks rules and the globals a
// React Native runtime provides. Deliberately NOT built on ./next.js: that
// preset pulls `next/core-web-vitals`, which wires @next/eslint-plugin-next
// and jsx-a11y DOM rules. React Native has no DOM, no <a>, no <img> — those
// rules would either misfire or sit inert, and eslint-config-next would drag
// a Next.js dependency into a project that has none.
//
// Usage from a consumer's eslint.config.js:
//   import { expoConfig } from "@school-kit/config/eslint/expo";
//   export default [...expoConfig, /* consumer overrides */];

import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig } from "./base.js";

// React Native's global surface. This is NOT the browser global set: there is
// no window, no document, no localStorage. Listing them explicitly (rather
// than reaching for globals.browser) keeps `no-undef`-adjacent mistakes
// honest — a stray `localStorage` call is a real bug on mobile, and CLAUDE.md
// already treats localStorage token storage as a security problem on web.
const REACT_NATIVE_GLOBALS = {
  __DEV__: "readonly",
  console: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  FormData: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  queueMicrotask: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  performance: "readonly",
  process: "readonly",
};

export const expoConfig = [
  ...baseConfig,

  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: REACT_NATIVE_GLOBALS,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // The automatic JSX runtime is on (Expo/Metro default), so neither
      // `React` in scope nor a React import is required.
      ...react.configs.flat["jsx-runtime"].rules,

      // Same bump as the Next preset: a missing dependency in
      // useEffect/useMemo/useCallback is a real class of failure, so CI
      // blocks on it rather than warning.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // React Native components take a `style` prop, not `className`, and
      // prop-types are redundant under TypeScript.
      "react/prop-types": "off",
    },
  },

  // Node-context files: build scripts and config that run under Node, not
  // Metro. `process`/`console` are legitimate here and the RN globals above
  // are not the right set.
  {
    files: ["scripts/**", "*.config.{js,mjs,ts}", "**/*.config.{js,mjs,ts}"],
    rules: {
      "no-console": "off",
    },
  },

  // metro.config.js and babel.config.js MUST be CommonJS — Metro and Babel
  // both load them through require(), so `module.exports` and `require()` are
  // required, not stylistic. This is also why an Expo app cannot simply set
  // `"type": "module"` in package.json the way apps/web and apps/portal do:
  // that would reinterpret these two files as ESM and break the bundler.
  // (The ESLint config file itself sidesteps the same problem by being
  // named eslint.config.mjs.)
  {
    files: ["metro.config.js", "babel.config.js", "**/metro.config.js", "**/babel.config.js"],
    languageOptions: {
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Test files: console.log is fine, and `any` is a pragmatic escape hatch
  // in fixtures. Mirrors the same block in ./next.js so the two presets stay
  // recognisably siblings.
  {
    files: ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}", "**/__tests__/**"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
