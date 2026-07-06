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

      // basePrisma bypasses RLS tenant scoping — it's the raw Prisma
      // client. EVERY tenant-bound DB access MUST go through withTenant
      // (which opens a tx + sets app.current_school_id), or — for
      // documented pre-tenant cases (signup tx, SECURITY DEFINER
      // lookups, schools/roles which have no RLS) — through the
      // explicit allowlist below. A new module importing basePrisma
      // outside the allowlist is, almost always, a tenant-isolation
      // bug. The allowlist override is in this file (see the "files:"
      // override blocks at the end of baseConfig).
      //
      // Adopted in slice 6 cp1 alongside the BullMQ worker work: the
      // worker establishes tenant context via tenantWorker() → withTenant,
      // and we want "skip the wrapper and call basePrisma directly" to
      // be a CI failure, not a runtime hope.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@school-kit/db",
              importNames: ["basePrisma"],
              message:
                "Use withTenant(schoolId, db => ...) for tenant-scoped access. basePrisma bypasses RLS — see CLAUDE.md 'Multi-tenancy' hard rules.",
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // basePrisma allowlist — files that legitimately import the raw client.
  //
  // Adding a new entry to this list is a security-relevant decision. The
  // bar is: this file accesses Postgres BEFORE a tenant is known (e.g. it
  // resolves a bearer token), OR it accesses a non-RLS table (schools,
  // roles, sessions), OR it is the helper that defines withTenant. If
  // none of those apply, the file should use withTenant instead — the
  // lint failure is correct.
  //
  // Patterns use **/ so they match regardless of which package is the
  // ESLint root (each app runs ESLint from its own dir; flat-config
  // `files:` patterns are relative to that cwd, so unanchored globs
  // are the safest cross-package form).
  // ---------------------------------------------------------------------
  {
    files: [
      // packages/db: tenant-client.ts defines basePrisma; index.ts re-exports
      // it; seeds and migration helpers run pre-tenant by definition.
      "**/packages/db/**",
      "**/db/src/**",
      "**/prisma/seed.ts",
      "**/prisma/seed.mts",

      // Test files: setup/teardown legitimately uses basePrisma to manage
      // test schools (the schools table itself has no RLS). The RLS spec
      // intentionally tests cross-tenant behaviour via basePrisma.
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",

      // apps/api specific pre-tenant call sites. Each one corresponds to
      // a known SECURITY DEFINER function or a non-RLS table:
      //   - auth.guard.ts            session resolution PRE-tenant
      //   - auth.service.ts          signup tx + login/uniqueness SECURITY DEFINER
      //   - schools.service.ts       schools table is non-RLS (Phase 0 design)
      //   - users.service.ts         reads schools (non-RLS) for status checks
      //   - invitations.service.ts   reads schools + roles (non-RLS) +
      //                              auth_resolve_invitation_by_token_hash (SD)
      // If a NEW callsite needs basePrisma, prove it falls into one of
      // these categories and add it here with a comment that says which.
      //
      // Patterns are unanchored ("**/<name>") because each app runs
      // ESLint from its own working directory; flat-config `files:`
      // patterns resolve relative to that cwd, so an anchored path
      // like "apps/api/src/..." would silently never match when
      // running from inside apps/api.
      "**/common/auth/auth.guard.ts",
      "**/modules/auth/auth.service.ts",
      "**/modules/schools/schools.service.ts",
      "**/modules/users/users.service.ts",
      "**/modules/invitations/invitations.service.ts",
      // health.controller.ts runs GET /health/db PRE-tenant (no auth token,
      // no schoolId). It issues a single SELECT current_user to verify the
      // runtime DB role is app_user (not school_kit). No tenant data touched.
      "**/health/health.controller.ts",
      // partition.service.ts calls SELECT create_audit_log_partition(), a
      // SECURITY DEFINER function that issues CREATE TABLE DDL. Schema-level
      // partition management has no school context — it is pre-tenant by
      // definition, exactly like the auth SECURITY DEFINER call sites above.
      "**/modules/system/partition.service.ts",
      // finance.service.ts — transitionOverdueInvoices is a system cron that iterates
      // all schools. It uses basePrisma to fetch the school list, then calls withTenant
      // per school for the actual invoice updates. No tenant data is accessed via basePrisma.
      "**/modules/finance/finance.service.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
