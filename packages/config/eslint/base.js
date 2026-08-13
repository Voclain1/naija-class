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

// Two independent import bans share the single `no-restricted-imports` rule
// key. They are declared as named constants because ESLint flat config has no
// way to express "two separate instances of the same rule" — a later `files:`
// block replaces the rule wholesale. So each allowlist block below has to
// RE-ASSERT the ban it is NOT exempting, rather than switching the rule off.
// Getting that wrong is silent: the exempted files simply stop being checked
// for the other restriction too.

const BASE_PRISMA_RESTRICTION = {
  name: "@school-kit/db",
  importNames: ["basePrisma"],
  message:
    "Use withTenant(schoolId, db => ...) for tenant-scoped access. basePrisma bypasses RLS — see CLAUDE.md 'Multi-tenancy' hard rules.",
};

// Phase 5 / Slice 1 CP2. CLAUDE.md's AI hard rules require that EVERY call to
// messages.create logs to ai_generations and passes a per-school budget check
// BEFORE the call. Both guarantees live in AiGenerationService, which is the
// only consumer of packages/ai's AnthropicPort. If any module could construct
// its own Anthropic client, those rules would be a convention rather than a
// guarantee — exactly the failure this project already fixed once for
// basePrisma/RLS. Same shape, same reasoning: make bypass a CI failure.
const ANTHROPIC_SDK_RESTRICTION = {
  name: "@anthropic-ai/sdk",
  message:
    "Do not construct an Anthropic client directly. Call AiGenerationService (apps/api/src/common/ai), which enforces the per-school token budget BEFORE the call and writes the required ai_generations ledger row after it — see CLAUDE.md 'AI' hard rules. The only permitted importer is packages/ai/src/client.ts.",
};

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
        { paths: [BASE_PRISMA_RESTRICTION, ANTHROPIC_SDK_RESTRICTION] },
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
      // onboarding-nudge.service.ts — same category as finance.service.ts's
      // entry directly above: sendPendingNudges is a system cron that
      // iterates all ACTIVE schools. It uses basePrisma to fetch the
      // candidate school list, then calls withTenant per school for the
      // actual audit-log/academic-year/student reads and the nudge-sent
      // stamp. No tenant data is accessed via basePrisma.
      "**/modules/onboarding-nudge/onboarding-nudge.service.ts",
      // parent-summaries.service.ts — Phase 5 / Slice 5. Same category again:
      // sweepWeeklySummaries is a weekly system cron that iterates every
      // ACTIVE school which has opted into parent summaries. basePrisma
      // fetches ONLY the school id list (schools has no RLS); every read of
      // student, attendance, score, guardian and summary data, and every
      // write, goes through withTenant per school. No tenant data is accessed
      // via basePrisma.
      "**/modules/parent-summaries/parent-summaries.service.ts",
      // Phase 4 / Slice 2 — guardian portal auth. Same category as the
      // staff auth.guard.ts / auth.service.ts / invitations.service.ts
      // entries above: guardian_sessions/guardian_invitations are FORCE
      // RLS, and both call sites resolve a bearer token or an invitation
      // token PRE-tenant via a SECURITY DEFINER function (there is no
      // schoolId to scope to until after the lookup).
      "**/common/auth/guardian-auth.guard.ts",
      "**/modules/portal-auth/portal-auth.service.ts",
      // Platform super-admin — same category as the staff/guardian pairs
      // above: platform-admin.guard.ts resolves a bearer token PRE-tenant
      // via a SECURITY DEFINER function (platform_admin_resolve_session),
      // and platform-admin.service.ts's reads are cross-tenant BY DEFINITION
      // (platform_admin_list_schools/list_users) — there is no single
      // schoolId to scope a withTenant call to.
      "**/common/auth/platform-admin.guard.ts",
      "**/modules/platform-admin/platform-admin.service.ts",
      // School slug derivation (2026-08-12). Runs PRE-tenant by definition:
      // it picks the slug for a school row that does not exist yet, so there
      // is no schoolId to scope a withTenant call to. It reads exactly one
      // table — `schools`, which has no RLS at all — and selects only `id`
      // to answer "is this slug free?". Previously lived inline inside
      // platform-admin.service.ts (already allowlisted above, same
      // reasoning); it moved out when self-serve signup became a second
      // caller.
      "**/common/slug/school-slug.ts",
    ],
    rules: {
      // Exempts basePrisma ONLY. The Anthropic ban is deliberately re-asserted
      // rather than dropped: nothing in this allowlist (auth guards, pre-tenant
      // services, and — importantly — every *.spec.ts) has any business
      // constructing an Anthropic client. Specs in particular must use the
      // injected fake AnthropicPort, not the real SDK; a test that reaches the
      // live API would burn real tokens and depend on a network call.
      "no-restricted-imports": ["error", { paths: [ANTHROPIC_SDK_RESTRICTION] }],
    },
  },

  // ---------------------------------------------------------------------
  // Anthropic SDK allowlist — exactly one file.
  //
  // packages/ai/src/client.ts is the seam: it wraps the SDK behind the narrow
  // AnthropicPort interface that AiGenerationService depends on. Adding a
  // second entry to this list means someone can call Claude without a budget
  // check or a ledger row, which violates two CLAUDE.md AI hard rules at once.
  // There is no legitimate second importer — if a caller needs different
  // request options (streaming, thinking, tools), widen AnthropicPort instead.
  //
  // Must come AFTER the basePrisma allowlist block above so it wins for this
  // path; flat config resolves later blocks last.
  // ---------------------------------------------------------------------
  {
    files: ["**/packages/ai/src/client.ts", "**/ai/src/client.ts"],
    rules: {
      // Exempts the Anthropic SDK ONLY — basePrisma stays banned here.
      "no-restricted-imports": ["error", { paths: [BASE_PRISMA_RESTRICTION] }],
    },
  },
];
